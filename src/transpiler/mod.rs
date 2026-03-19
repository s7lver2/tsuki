// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: transpiler  (updated)
//  Now accepts a pre-built Runtime so external library packages are
//  already registered before code-gen begins.
// ─────────────────────────────────────────────────────────────────────────────

pub mod config;
pub use config::TranspileConfig;

use std::collections::{HashMap, HashSet};
use std::fmt::Write as FmtWrite;

use crate::error::{TsukiError, Result};
use crate::parser::ast::*;
use crate::runtime::Runtime;

// ─────────────────────────────────────────────────────────────────────────────

pub struct Transpiler {
    cfg:       TranspileConfig,
    rt:        Runtime,
    indent:    usize,
    includes:  HashSet<String>,
    pkg_map:   HashMap<String, String>,
    /// Maps local variable names → canonical package name for instance-method dispatch.
    /// e.g. `sensor` → `"dht"` when declared as `var sensor dht.DHT`.
    var_types: HashMap<String, String>,
}

impl Transpiler {
    /// Create with default (built-in only) runtime.
    pub fn new(cfg: TranspileConfig) -> Self {
        Self::with_runtime(cfg, Runtime::new())
    }

    /// Create with a pre-built runtime (may contain external libs).
    pub fn with_runtime(cfg: TranspileConfig, rt: Runtime) -> Self {
        Self {
            cfg,
            rt,
            indent:    0,
            includes:  HashSet::new(),
            pkg_map:   HashMap::new(),
            var_types: HashMap::new(),
        }
    }

    pub fn generate(&mut self, prog: &Program) -> Result<String> {
        self.resolve_imports(&prog.imports);
        self.includes.insert("Arduino.h".into());

        let mut structs   = Vec::new();
        let mut typedefs  = Vec::new();
        let mut constants = Vec::new();
        let mut globals   = Vec::new();
        let mut funcs     = Vec::new();

        for d in &prog.decls {
            match d {
                Decl::StructDef { .. } => structs.push(d),
                Decl::TypeDef   { .. } => typedefs.push(d),
                Decl::Const     { .. } => constants.push(d),
                Decl::Var       { .. } => globals.push(d),
                Decl::Func      { .. } => funcs.push(d),
            }
        }

        let mut out = String::new();
        out += &self.header(&prog.package);

        let mut incs: Vec<_> = self.includes.iter().cloned().collect();
        incs.sort();
        for i in &incs { out += &format!("#include <{}>\n", i); }
        out += "\n";

        for td in &typedefs  { out += &self.emit_typedef(td)?; }
        if !typedefs.is_empty() { out += "\n"; }

        for s in &structs    { out += &self.emit_struct(s)?; }
        if !structs.is_empty() { out += "\n"; }

        // Clone to release the shared borrow on prog.decls so emit_const
        // can take &mut self (needed to update var_types for webkit consts).
        let constants_owned: Vec<_> = constants.iter().map(|d| (*d).clone()).collect();
        for c in &constants_owned { out += &self.emit_const(c)?; }
        if !constants_owned.is_empty() { out += "\n"; }

        let globals_owned: Vec<_> = globals.iter().map(|d| (*d).clone()).collect();
        for g in &globals_owned { out += &self.emit_global(g)?; }
        if !globals_owned.is_empty() { out += "\n"; }

        for f in &funcs {
            if let Decl::Func { name, sig, recv: None, .. } = f {
                if name != "setup" && name != "loop" {
                    out += &self.emit_func_fwd(name, sig)?;
                }
            }
        }
        out += "\n";

        let mut saw_setup = false;
        let mut saw_loop  = false;
        for f in &funcs {
            if let Decl::Func { name, .. } = f {
                // Go's main() is transpiled to setup()
                if name == "setup" || name == "main" { saw_setup = true; }
                if name == "loop"  { saw_loop  = true; }
            }
            out += &self.emit_func(f)?;
            out += "\n";
        }

        if !saw_setup { out += "void setup() {}\n\n"; }
        if !saw_loop  { out += "void loop()  {}\n\n"; }

        Ok(out)
    }

    // ── Imports ───────────────────────────────────────────────────────────────

    fn resolve_imports(&mut self, imports: &[Import]) {
        for imp in imports {
            let raw_path: String = imp.path.split('/').last()
                .unwrap_or(&imp.path).to_owned();

            // Normalise hyphenated package names to a valid C identifier.
            // e.g. "tsuki-webkit" → "tsuki_webkit"
            let canon: String = raw_path.replace('-', "_");

            // The Go alias: if user wrote `import tw "tsuki-webkit"` use "tw",
            // otherwise derive from the last path segment keeping hyphens as
            // they appear in Go source so the parser can look them up.
            let alias = if let Some(a) = &imp.alias {
                a.clone()
            } else {
                raw_path.clone()   // keep original (may contain hyphens)
            };

            // Also register the underscore-normalised alias so both
            // `tsuki-webkit.X` and `tsuki_webkit.X` resolve correctly.
            self.pkg_map.insert(alias.clone(), canon.clone());
            if alias != canon {
                self.pkg_map.insert(canon.clone(), canon.clone());
            }

            // ── tsuki-webkit: inject the generated header instead of a pkg lookup ──
            if canon == "tsuki_webkit" || raw_path == "tsuki-webkit" {
                self.includes.insert("tsuki_webkit_gen.h".into());
                // webkit is a C++ lib injected by tsuki-flash — no further
                // runtime lookup needed.
                continue;
            }

            if let Some(pkg) = self.rt.pkg(&canon) {
                if let Some(h) = &pkg.header {
                    self.includes.insert(h.clone());
                }
            }
        }
    }

    fn header(&self, pkg: &str) -> String {
        format!(
            "// Generated by tsuki v{} — do not edit manually.\n// Source package: {}\n\n",
            env!("CARGO_PKG_VERSION"), pkg
        )
    }

    fn pad(&self) -> String { "    ".repeat(self.indent) }
    fn push_indent(&mut self) { self.indent += 1; }
    fn pop_indent(&mut self)  { if self.indent > 0 { self.indent -= 1; } }

    fn emit_typedef(&self, d: &Decl) -> Result<String> {
        if let Decl::TypeDef { name, ty, .. } = d {
            Ok(format!("typedef {} {};\n", ty.to_cpp(), name))
        } else { Ok(String::new()) }
    }

    fn emit_struct(&self, d: &Decl) -> Result<String> {
        if let Decl::StructDef { name, fields, .. } = d {
            let mut s = format!("struct {} {{\n", name);
            for f in fields {
                let fname = f.name.as_deref().unwrap_or("_");
                s += &format!("    {} {};\n", f.ty.to_cpp(), fname);
            }
            s += "};\n";
            Ok(s)
        } else { Ok(String::new()) }
    }

    fn emit_const(&mut self, d: &Decl) -> Result<String> {
        if let Decl::Const { name, ty, val, .. } = d {
            // ── tsuki-webkit: const app = tsuki_webkit.ApiInit() ─────────────
            if let Expr::Call { func, .. } = val {
                if let Expr::Select { expr, .. } = func.as_ref() {
                    if let Expr::Ident { name: pkg_alias, .. } = expr.as_ref() {
                        if let Some(canon) = self.pkg_map.get(pkg_alias.as_str()).cloned() {
                            if canon == "tsuki_webkit" {
                                self.var_types.insert(name.clone(), canon);
                                // Emit a zero-size tag struct + static instance.
                                // The actual webkit C++ is injected by tsuki-flash
                                // via webkit_setup_routes() / webkit_tick().
                                return Ok(format!(
                                    "struct WebkitHandle {{}};\nstatic WebkitHandle {};\n",
                                    name
                                ));
                            }
                        }
                    }
                }
            }
            let v = self.emit_expr(val)?;
            let t = ty.as_ref().map(|t| t.to_cpp()).unwrap_or_else(|| "auto".into());
            Ok(format!("const {} {} = {};\n", t, name, v))
        } else { Ok(String::new()) }
    }

    fn emit_global(&mut self, d: &Decl) -> Result<String> {
        if let Decl::Var { name, ty, init, .. } = d {
            // ── tsuki-webkit: detect  `const app = tsuki_webkit.ApiInit()` ────
            // The init expression is a call like `tsuki_webkit.ApiInit()`.
            // After the pre-processor the alias is already `tsuki_webkit`.
            // We register `app` → `tsuki_webkit` so that `app.setup()` and
            // `app.tick()` resolve correctly, and suppress the C++ initialiser
            // (webkit_setup_routes is called explicitly from setup()).
            if let Some(init_expr) = init {
                if let Expr::Call { func, .. } = init_expr {
                    if let Expr::Select { expr, field, .. } = func.as_ref() {
                        if let Expr::Ident { name: pkg_alias, .. } = expr.as_ref() {
                            if let Some(canon) = self.pkg_map.get(pkg_alias.as_str()).cloned() {
                                if canon == "tsuki_webkit" {
                                    // Register the variable so instance calls work
                                    self.var_types.insert(name.clone(), canon.clone());
                                    // Emit a WebkitHandle struct — zero-size, just a tag
                                    return Ok(format!(
                                        "struct WebkitHandle {{}};\nWebkitHandle {};\n",
                                        name
                                    ));
                                }
                            }
                        }
                    }
                }
            }

            // Track variable → package for instance-method dispatch
            if let Some(Type::Named(type_name)) = ty {
                let pkg_part = type_name.split('.').next().unwrap_or("");
                if let Some(canon) = self.pkg_map.get(pkg_part).cloned() {
                    self.var_types.insert(name.clone(), canon.clone());
                    // If this package declares a C++ class, emit as pointer
                    // (many Arduino libs lack a default constructor).
                    if let Some(pkg) = self.rt.pkg(&canon) {
                        if let Some(class) = pkg.cpp_class.clone() {
                            let init_str = if let Some(e) = init {
                                format!(" = new {}", self.emit_expr(e)?)
                            } else {
                                " = nullptr".to_string()
                            };
                            return Ok(format!("{}* {}{};
", class, name, init_str));
                        }
                    }
                }
            }
            let t    = ty.as_ref().map(|t| t.to_cpp()).unwrap_or_else(|| "auto".into());
            let init = init.as_ref().map(|e| self.emit_expr(e)).transpose()?
                .map(|s| format!(" = {}", s)).unwrap_or_default();
            Ok(format!("{} {}{};
", t, name, init))
        } else { Ok(String::new()) }
    }

    fn emit_func_fwd(&self, name: &str, sig: &FuncSig) -> Result<String> {
        // Go's main() becomes setup() — don't forward-declare it under "main"
        let cpp_name = if name == "main" { "setup" } else { name };
        Ok(format!("{} {}({});\n", ret_type(sig), cpp_name, params_str(sig)))
    }

    fn emit_func(&mut self, d: &Decl) -> Result<String> {
        if let Decl::Func { name, recv, sig, body, .. } = d {
            let ret    = ret_type(sig);
            let params = params_str(sig);

            let full_name = if let Some(r) = recv {
                let type_name = match &r.ty {
                    Type::Ptr(inner) => match inner.as_ref() { Type::Named(n) => n.clone(), t => t.to_cpp() },
                    Type::Named(n)   => n.clone(),
                    t                => t.to_cpp(),
                };
                format!("{}::{}", type_name, name)
            } else {
                // Go's main() → Arduino's setup(); mark saw_setup in caller
                if name == "main" { "setup".to_owned() } else { name.clone() }
            };

            let body_str = if let Some(b) = body {
                self.emit_block(b)?
            } else {
                ";".into()
            };

            Ok(format!("{} {}({}) {}\n", ret, full_name, params, body_str))
        } else { Ok(String::new()) }
    }

    fn emit_block(&mut self, block: &Block) -> Result<String> {
        self.push_indent();
        let mut s = "{\n".to_string();
        for stmt in &block.stmts {
            s += &self.emit_stmt(stmt)?;
        }
        self.pop_indent();
        s += &format!("{}}}", self.pad());
        Ok(s)
    }

    fn emit_stmt(&mut self, stmt: &Stmt) -> Result<String> {
        let pad = self.pad();
        Ok(match stmt {
            Stmt::VarDecl { name, ty, init, .. } => {
                let t    = ty.as_ref().map(|t| t.to_cpp()).unwrap_or_else(|| "auto".into());
                let init = init.as_ref().map(|e| self.emit_expr(e)).transpose()?
                    .map(|s| format!(" = {}", s)).unwrap_or_default();
                format!("{}{} {}{};\n", pad, t, name, init)
            }
            Stmt::ConstDecl { name, ty, val, .. } => {
                let t = ty.as_ref().map(|t| t.to_cpp()).unwrap_or_else(|| "auto".into());
                format!("{}const {} {} = {};\n", pad, t, name, self.emit_expr(val)?)
            }
            Stmt::ShortDecl { names, vals, .. } => {
                let mut s = String::new();
                for (i, name) in names.iter().enumerate() {
                    let val = vals.get(i).map(|v| self.emit_expr(v))
                        .unwrap_or_else(|| Ok("0".into()))?;
                    // Infer package type from RHS constructor call (Bug 2)
                    // e.g. `sensor := dht.New(...)` → var_types["sensor"] = "dht"
                    if let Some(val_node) = vals.get(i) {
                        if let Expr::Call { func, .. } = val_node {
                            if let Expr::Select { expr: pkg_expr, .. } = func.as_ref() {
                                if let Expr::Ident { name: pkg_alias, .. } = pkg_expr.as_ref() {
                                    if let Some(canon) = self.pkg_map.get(pkg_alias.as_str()).cloned() {
                                        self.var_types.insert(name.clone(), canon);
                                    }
                                }
                            }
                        }
                    }
                    s += &format!("{}auto {} = {};\n", pad, name, val);
                }
                s
            }
            Stmt::Assign { lhs, rhs, op, .. } => {
                let mut s = String::new();
                for (i, l) in lhs.iter().enumerate() {
                    let r = rhs.get(i).map(|v| self.emit_expr(v))
                        .unwrap_or_else(|| Ok("0".into()))?;
                    s += &format!("{}{} {} {};\n", pad, self.emit_expr(l)?, op.to_cpp(), r);
                }
                s
            }
            Stmt::Inc { expr, .. } => format!("{}{}++;\n", pad, self.emit_expr(expr)?),
            Stmt::Dec { expr, .. } => format!("{}{}--;\n", pad, self.emit_expr(expr)?),
            Stmt::Return { vals, .. } => {
                match vals.len() {
                    0 => format!("{}return;\n", pad),
                    1 => format!("{}return {};\n", pad, self.emit_expr(&vals[0])?),
                    _ => {
                        let vs: Vec<_> = vals.iter().map(|v| self.emit_expr(v)).collect::<Result<_>>()?;
                        format!("{}return {{ {} }}; // multi-return\n", pad, vs.join(", "))
                    }
                }
            }
            Stmt::If { init, cond, then, else_, .. } => {
                let init_s = if let Some(i) = init {
                    let raw = self.emit_stmt(i)?;
                    format!("{} ", raw.trim().trim_end_matches(';'))
                } else { String::new() };
                let cond_s = self.emit_expr(cond)?;
                let then_s = self.emit_block(then)?;
                let else_s = if let Some(e) = else_ {
                    let body = match e.as_ref() {
                        Stmt::If { .. } => self.emit_stmt(e)?.trim_start().to_string(),
                        Stmt::Block(b)  => self.emit_block(b)?,
                        other           => self.emit_stmt(other)?.trim().to_string(),
                    };
                    format!(" else {}", body)
                } else { String::new() };
                format!("{}if ({}{}) {}{}\n", pad, init_s, cond_s, then_s, else_s)
            }
            Stmt::For { init, cond, post, body, .. } => {
                let init_s = flat_stmt_opt(init, self)?;
                let cond_s = cond.as_ref().map(|c| self.emit_expr(c))
                    .transpose()?.unwrap_or_default();
                let post_s = flat_stmt_opt(post, self)?;
                let body_s = self.emit_block(body)?;
                format!("{}for ({}; {}; {}) {}\n", pad, init_s, cond_s, post_s, body_s)
            }
            Stmt::Range { key, val, iter, body, .. } => {
                let arr    = self.emit_expr(iter)?;
                let k      = key.as_deref().unwrap_or("_i").to_owned();
                let body_s = self.emit_block(body)?;
                if let Some(vname) = val {
                    format!(
                        "{pad}for (int32_t {k} = 0; {k} < (int32_t)(sizeof({a})/sizeof({a}[0])); {k}++) {{\n\
                         {pad}    auto {v} = {a}[{k}];\n\
                         {pad}}}\n",
                        pad = pad, k = k, a = arr, v = vname,
                    )
                } else {
                    format!(
                        "{pad}for (int32_t {k} = 0; {k} < (int32_t)(sizeof({a})/sizeof({a}[0])); {k}++) {body}\n",
                        pad = pad, k = k, a = arr, body = body_s,
                    )
                }
            }
            Stmt::Switch { tag, cases, .. } => {
                if tag.is_none() {
                    // Tagless switch: `switch { case cond: ... }` → if/else if/else
                    let mut s = String::new();
                    for (idx, case) in cases.iter().enumerate() {
                        if case.exprs.is_empty() {
                            // default clause
                            s += &format!("{} else {{\n", "");
                        } else {
                            let conds: Vec<String> = case.exprs.iter()
                                .map(|e| self.emit_expr(e))
                                .collect::<Result<_>>()?;
                            let cond_s = conds.join(" || ");
                            if idx == 0 {
                                s += &format!("{}if ({}) {{\n", pad, cond_s);
                            } else {
                                s += &format!(" else if ({}) {{\n", cond_s);
                            }
                        }
                        self.push_indent();
                        for st in &case.body { s += &self.emit_stmt(st)?; }
                        self.pop_indent();
                        s += &format!("{}}}", pad);
                    }
                    s += "\n";
                    s
                } else {
                    // Tagged switch: `switch expr { case val: ... }`
                    let tag_s = self.emit_expr(tag.as_ref().unwrap())?;
                    let mut s = format!("{}switch ({}) {{\n", pad, tag_s);
                    self.push_indent();
                    for case in cases {
                        let cpad = self.pad();
                        if case.exprs.is_empty() {
                            s += &format!("{}default:\n", cpad);
                        } else {
                            for e in &case.exprs {
                                s += &format!("{}case {}:\n", cpad, self.emit_expr(e)?);
                            }
                        }
                        self.push_indent();
                        for st in &case.body { s += &self.emit_stmt(st)?; }
                        s += &format!("{}break;\n", self.pad());
                        self.pop_indent();
                    }
                    self.pop_indent();
                    s += &format!("{}}}\n", pad);
                    s
                }
            }
            Stmt::Block(b) => {
                let s = self.emit_block(b)?;
                format!("{}{}\n", pad, s)
            }
            Stmt::Expr { expr, .. } => format!("{}{};\n", pad, self.emit_expr(expr)?),
            Stmt::Break    { .. }        => format!("{}break;\n",    pad),
            Stmt::Continue { .. }        => format!("{}continue;\n", pad),
            Stmt::Goto     { label, .. } => format!("{}goto {};\n",  pad, label),
            Stmt::Label    { name, .. }  => format!("{}{}:\n",       pad, name),
            Stmt::Defer { call, .. } => {
                let ann = if self.cfg.annotate_unsupported {
                    "/* defer — RAII wrapper not yet emitted */"
                } else { "" };
                format!("{}{} {};\n", pad, ann, self.emit_expr(call)?)
            }
            Stmt::Go { call, .. } => {
                let ann = if self.cfg.annotate_unsupported {
                    "/* goroutine — not supported on bare metal */"
                } else { "" };
                format!("{}{} {};\n", pad, ann, self.emit_expr(call)?)
            }
        })
    }

    fn emit_expr(&self, expr: &Expr) -> Result<String> {
        Ok(match expr {
            Expr::Int(n)   => n.to_string(),
            Expr::Float(f) => {
                let s = format!("{}", f);
                if s.contains('.') { s } else { format!("{}.0", s) }
            }
            Expr::Str(s)   => {
                // Escape every byte so the C++ string literal is always valid.
                // Go strings may contain real newlines, tabs, or non-ASCII bytes
                // (e.g. em-dash as UTF-8) that would break avr-gcc otherwise.
                let mut escaped = String::new();
                for byte in s.bytes() {
                    match byte {
                        b'\\' => escaped.push_str("\\\\"),
                        b'"'  => escaped.push_str("\\\""),
                        b'\n' => escaped.push_str("\\n"),
                        b'\r' => escaped.push_str("\\r"),
                        b'\t' => escaped.push_str("\\t"),
                        0x20..=0x7E => escaped.push(byte as char), // printable ASCII
                        other => { let _ = write!(escaped, "\\x{:02X}", other); }
                    }
                }
                if self.cfg.arduino_string {
                    format!("String(\"{}\")", escaped)
                } else {
                    format!("\"{}\"", escaped)
                }
            }
            Expr::Rune(c)  => format!("'{}'", c),
            Expr::Bool(b)  => if *b { "true".into() } else { "false".into() },
            Expr::Nil      => "nullptr".into(),
            Expr::Raw(s)   => s.clone(),
            Expr::Ident { name, .. } => self.resolve_ident(name),
            Expr::Binary { op, lhs, rhs, .. } => {
                format!("({} {} {})", self.emit_expr(lhs)?, op.to_cpp(), self.emit_expr(rhs)?)
            }
            Expr::Unary { op, expr, .. } => {
                format!("({}{})", op.to_cpp(), self.emit_expr(expr)?)
            }
            Expr::Call { func, args, .. } => self.emit_call(func, args)?,
            Expr::Index { expr, idx, .. } => {
                format!("{}[{}]", self.emit_expr(expr)?, self.emit_expr(idx)?)
            }
            Expr::Slice { expr, lo, hi, .. } => {
                let a  = self.emit_expr(expr)?;
                let lo = lo.as_ref().map(|e| self.emit_expr(e)).transpose()?
                    .unwrap_or_else(|| "0".into());
                let hi = hi.as_ref().map(|e| self.emit_expr(e)).transpose()?
                    .unwrap_or_else(|| format!("sizeof({})/sizeof({}[0])", a, a));
                format!("/* &{}[{}..{}] */", a, lo, hi)
            }
            Expr::Select { expr, field, .. } => {
                if let Expr::Ident { name: alias, .. } = expr.as_ref() {
                    let canon = self.pkg_map.get(alias.as_str())
                        .cloned().unwrap_or_else(|| alias.clone());
                    if let Some(pkg) = self.rt.pkg(&canon) {
                        if let Some(const_val) = pkg.constants.get(field.as_str()) {
                            return Ok(const_val.clone());
                        }
                    }
                    if self.cfg.passthrough_unknown {
                        return Ok(format!("{}.{}", alias, field));
                    }
                    return Err(TsukiError::codegen(format!("no mapping for {}.{}", canon, field)));
                }
                format!("{}.{}", self.emit_expr(expr)?, field)
            }
            Expr::TypeAssert { expr, .. } => self.emit_expr(expr)?,
            Expr::Composite { elems, .. } => {
                let vals: Vec<_> = elems.iter()
                    .map(|e| self.emit_expr(&e.val))
                    .collect::<Result<_>>()?;
                format!("{{{}}}", vals.join(", "))
            }
            Expr::FuncLit { sig, .. } => {
                format!("[&]({}) -> {} {{ /* lambda body */ }}",
                    params_str(sig), ret_type(sig))
            }
        })
    }

    fn emit_call(&self, func: &Expr, args: &[Expr]) -> Result<String> {
        // Detect printf-style calls (fmt.Printf / fmt.Fprintf / fmt.Sprintf) so we
        // can emit the format string as a raw C-string literal instead of String("...").
        let is_printf_style = matches!(func,
            Expr::Select { field, .. } if matches!(field.as_str(), "Printf" | "Fprintf" | "Sprintf" | "Errorf")
        );

        let arg_strs: Vec<String> = args.iter().enumerate()
            .map(|(i, a)| {
                // First arg of a printf call must be const char*, not String("...")
                if is_printf_style && i == 0 {
                    self.emit_str_raw(a)
                } else {
                    self.emit_expr(a)
                }
            })
            .collect::<Result<_>>()?;

        match func {
            Expr::Select { expr, field, .. } => {
                if let Expr::Ident { name: alias, .. } = expr.as_ref() {
                    // ── tsuki-webkit static calls ─────────────────────────────────────
                    // tsuki_webkit.ApiInit()  → /* webkit: call webkit_setup_routes() in setup() */
                    // tsuki_webkit.WebInit()  → same
                    if let Some(canon) = self.pkg_map.get(alias.as_str()) {
                        if canon == "tsuki_webkit" {
                            return Ok(match field.as_str() {
                                "ApiInit" | "WebInit" => {
                                    // Returns a WebkitHandle — represented as a
                                    // unit struct in C++. The real work happens in
                                    // webkit_setup_routes() called from setup().
                                    "WebkitHandle{}".into()
                                }
                                other => format!("webkit_{}({})", other.to_lowercase(), arg_strs.join(", ")),
                            });
                        }
                    }
                    // ── tsuki-webkit instance method calls ────────────────────────────
                    // app.setup()  → webkit_setup_routes()
                    // app.tick()   → webkit_tick()
                    // app.WiFi(ssid, pass)  → webkit_wifi(ssid, pass)
                    // app.Handle(m, p, fn) → webkit_handle(m, p, fn)
                    if let Some(pkg_name) = self.var_types.get(alias.as_str()) {
                        if pkg_name == "tsuki_webkit" {
                            return Ok(match field.as_str() {
                                "setup"  => "webkit_setup_routes()".into(),
                                "tick"   => "webkit_tick()".into(),
                                "WiFi"   => format!("webkit_wifi({})", arg_strs.join(", ")),
                                "Handle" => format!("webkit_handle({})", arg_strs.join(", ")),
                                "LocalIP"=> "webkit_local_ip()".into(),
                                other    => format!("webkit_{}({})", other.to_lowercase(), arg_strs.join(", ")),
                            });
                        }
                    }

                    // ── Case 1: static package call  e.g. dht.New(pin, type) ──────────
                    if let Some(canon) = self.pkg_map.get(alias.as_str()).cloned() {
                        if let Some(pkg) = self.rt.pkg(&canon) {
                            if let Some(fmap) = pkg.functions.get(field.as_str()) {
                                return Ok(fmap.apply(&arg_strs));
                            }
                        }
                        if self.cfg.passthrough_unknown {
                            return Ok(format!("{}.{}({})", alias, field, arg_strs.join(", ")));
                        }
                        return Err(TsukiError::codegen(
                            format!("no mapping for {}.{}", canon, field)));
                    }

                    // ── Case 2: instance method call  e.g. sensor.Begin() ────────────
                    // Look up the variable's declared package, prepend receiver as {0}.
                    if let Some(pkg_name) = self.var_types.get(alias.as_str()).cloned() {
                        if let Some(pkg) = self.rt.pkg(&pkg_name) {
                            if let Some(fmap) = pkg.functions.get(field.as_str()) {
                                let mut all_args = vec![alias.clone()];
                                all_args.extend_from_slice(&arg_strs);
                                return Ok(fmap.apply(&all_args));
                            }
                        }
                        if self.cfg.passthrough_unknown {
                            return Ok(format!("{}.{}({})", alias, field, arg_strs.join(", ")));
                        }
                        return Err(TsukiError::codegen(
                            format!("no method mapping for {}.{} (package: {})", alias, field, pkg_name)));
                    }
                }
                // ── Chained: pkg.SubObj.Method(args)  e.g. arduino.Serial.Begin(9600) ──
                if let Expr::Select { expr: inner_expr, field: sub_obj, .. } = expr.as_ref() {
                    if let Expr::Ident { name: pkg_alias, .. } = inner_expr.as_ref() {
                        if self.pkg_map.contains_key(pkg_alias.as_str()) {
                            let sub_canon = sub_obj.to_lowercase();
                            if let Some(sub_pkg) = self.rt.pkg(&sub_canon) {
                                if let Some(fmap) = sub_pkg.functions.get(field.as_str()) {
                                    return Ok(fmap.apply(&arg_strs));
                                }
                            }
                            if self.cfg.passthrough_unknown {
                                return Ok(format!("{}.{}({})", sub_obj, field, arg_strs.join(", ")));
                            }
                            return Err(TsukiError::codegen(
                                format!("no mapping for {}.{}.{}", pkg_alias, sub_obj, field)));
                        }
                    }
                }
                let obj = self.emit_expr(expr)?;
                Ok(format!("{}.{}({})", obj, field, arg_strs.join(", ")))
            }
            Expr::Ident { name, .. } => {
                if let Some(bm) = self.rt.builtin(name) {
                    return Ok(bm.apply(&arg_strs));
                }
                Ok(format!("{}({})", self.resolve_ident(name), arg_strs.join(", ")))
            }
            _ => Ok(format!("{}({})", self.emit_expr(func)?, arg_strs.join(", "))),
        }
    }

    /// Emit a string expression always as a raw C-string literal (`"..."`)
    /// regardless of `arduino_string`, for use as printf format arguments.
    fn emit_str_raw(&self, expr: &Expr) -> Result<String> {
        if let Expr::Str(s) = expr {
            let mut escaped = String::new();
            for byte in s.bytes() {
                match byte {
                    b'\\' => escaped.push_str("\\\\"),
                    b'"'  => escaped.push_str("\\\""),
                    b'\n' => escaped.push_str("\\n"),
                    b'\r' => escaped.push_str("\\r"),
                    b'\t' => escaped.push_str("\\t"),
                    0x20..=0x7E => escaped.push(byte as char),
                    other => { let _ = write!(escaped, "\\x{:02X}", other); }
                }
            }
            Ok(format!("\"{}\"", escaped))
        } else {
            // Not a literal string — emit normally and strip String() wrapper if present
            let s = self.emit_expr(expr)?;
            if s.starts_with("String(\"") && s.ends_with("\")") {
                Ok(s[7..s.len()-1].to_owned())
            } else {
                Ok(s)
            }
        }
    }

    fn resolve_ident(&self, name: &str) -> String {
        for (_alias, canon) in &self.pkg_map {
            if let Some(pkg) = self.rt.pkg(canon) {
                if let Some(cpp) = pkg.constants.get(name) {
                    return cpp.clone();
                }
            }
        }
        name.to_owned()
    }
}

// ─────────────────────────────────────────────────────────────────────────────

fn params_str(sig: &FuncSig) -> String {
    sig.params.iter().enumerate().map(|(i, p)| {
        let n = p.name.as_deref().unwrap_or("").to_owned();
        let n = if n.is_empty() { format!("_p{}", i) } else { n };
        if p.variadic {
            format!(".../* {} */", p.ty.to_cpp())
        } else {
            format!("{} {}", p.ty.to_cpp(), n)
        }
    }).collect::<Vec<_>>().join(", ")
}

fn ret_type(sig: &FuncSig) -> String {
    match sig.results.len() {
        0 => "void".into(),
        1 => sig.results[0].ty.to_cpp(),
        _ => format!("/* multi: {} */",
            sig.results.iter().map(|r| r.ty.to_cpp()).collect::<Vec<_>>().join(", ")),
    }
}

fn flat_stmt_opt(stmt: &Option<Box<Stmt>>, t: &mut Transpiler) -> Result<String> {
    Ok(match stmt {
        None    => String::new(),
        Some(s) => {
            let raw = t.emit_stmt(s)?;
            raw.trim().trim_end_matches(';').to_string()
        }
    })
}