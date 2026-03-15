// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: python :: ast
//
//  AST for the Arduino-Python subset supported by tsuki.
//  Covers the features needed to write Arduino firmware in Python style.
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::Span;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A Python type annotation as a string (e.g. `"int"`, `"float"`, `"str"`).
pub type PyTypeAnn = String;

// ── Binary / Unary operators ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum BinOp {
    Add, Sub, Mul, Div, FloorDiv, Mod, Pow,
    Eq, NotEq, Lt, Gt, LtEq, GtEq,
    And, Or,
    BitAnd, BitOr, BitXor, LShift, RShift,
}

impl BinOp {
    pub fn to_cpp(&self) -> &'static str {
        match self {
            BinOp::Add     => "+",
            BinOp::Sub     => "-",
            BinOp::Mul     => "*",
            BinOp::Div     => "/",
            BinOp::FloorDiv => "/",  // integer division
            BinOp::Mod     => "%",
            BinOp::Pow     => "**",  // handled specially in transpiler → pow()
            BinOp::Eq      => "==",
            BinOp::NotEq   => "!=",
            BinOp::Lt      => "<",
            BinOp::Gt      => ">",
            BinOp::LtEq    => "<=",
            BinOp::GtEq    => ">=",
            BinOp::And     => "&&",
            BinOp::Or      => "||",
            BinOp::BitAnd  => "&",
            BinOp::BitOr   => "|",
            BinOp::BitXor  => "^",
            BinOp::LShift  => "<<",
            BinOp::RShift  => ">>",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum UnaryOp {
    Not,    // logical not  → !
    Neg,    // arithmetic negation → -
    BitNot, // bitwise NOT  → ~
}

// ── Expressions ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum PyExpr {
    /// Integer literal
    Int(i64),
    /// Float literal
    Float(f64),
    /// Boolean literal
    Bool(bool),
    /// String literal
    Str(String),
    /// `None`
    None,
    /// Identifier (variable or package name)
    Ident(String),
    /// Attribute access: `obj.attr`
    Attr {
        obj:  Box<PyExpr>,
        attr: String,
        span: Span,
    },
    /// Function / method call: `func(args)`
    Call {
        func: Box<PyExpr>,
        args: Vec<PyExpr>,
        span: Span,
    },
    /// Subscript: `obj[index]`
    Subscript {
        obj:   Box<PyExpr>,
        index: Box<PyExpr>,
        span:  Span,
    },
    /// Binary operation
    BinOp {
        left:  Box<PyExpr>,
        op:    BinOp,
        right: Box<PyExpr>,
        span:  Span,
    },
    /// Unary operation
    UnaryOp {
        op:      UnaryOp,
        operand: Box<PyExpr>,
        span:    Span,
    },
    /// f-string or simple string interpolation — emitted as snprintf equivalent
    FStr {
        parts: Vec<FStrPart>,
        span:  Span,
    },
    /// Tuple / list literal (mapped to C-array initialiser in limited contexts)
    List(Vec<PyExpr>),
}

#[derive(Debug, Clone)]
pub enum FStrPart {
    Literal(String),
    Expr(Box<PyExpr>),
}

// ── Statements ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum PyStmt {
    /// `target [: ann] = value`  or  `target [: ann]`
    Assign {
        target: String,
        ann:    Option<PyTypeAnn>,
        value:  Option<PyExpr>,
        span:   Span,
    },
    /// Augmented assignment: `target op= value`
    AugAssign {
        target: String,
        op:     BinOp,
        value:  PyExpr,
        span:   Span,
    },
    /// Expression statement (most common: function call)
    Expr(PyExpr),
    /// `return [value]`
    Return {
        value: Option<PyExpr>,
        span:  Span,
    },
    /// `if cond: ... [elif cond: ...] [else: ...]`
    If {
        cond:         PyExpr,
        body:         Vec<PyStmt>,
        elif_clauses: Vec<(PyExpr, Vec<PyStmt>)>,
        else_body:    Vec<PyStmt>,
        span:         Span,
    },
    /// `while cond: ...`
    While {
        cond: PyExpr,
        body: Vec<PyStmt>,
        span: Span,
    },
    /// `for var in iter: ...`
    For {
        var:  String,
        iter: PyExpr,
        body: Vec<PyStmt>,
        span: Span,
    },
    /// `pass`
    Pass(Span),
    /// `break`
    Break(Span),
    /// `continue`
    Continue(Span),
    /// `global x`
    Global {
        names: Vec<String>,
        span:  Span,
    },
    /// Inline comment (preserved as C++ comment)
    Comment(String),
}

// ── Function definition ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PyParam {
    pub name:    String,
    pub ann:     Option<PyTypeAnn>,
    pub default: Option<PyExpr>,
}

#[derive(Debug, Clone)]
pub struct PyFuncDef {
    pub name:        String,
    pub params:      Vec<PyParam>,
    pub return_type: Option<PyTypeAnn>,
    pub body:        Vec<PyStmt>,
    pub span:        Span,
}

// ── Top-level program ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PyImport {
    /// `import foo.bar` → module = "foo.bar", alias = None
    /// `import foo as f` → module = "foo", alias = Some("f")
    /// `from foo import bar` → module = "foo", names = ["bar"]
    pub module: String,
    pub alias:  Option<String>,
    /// Items from a `from ... import` statement
    pub names:  Vec<String>,
    pub span:   Span,
}

#[derive(Debug, Clone)]
pub struct PyProgram {
    /// Top-level import statements
    pub imports:   Vec<PyImport>,
    /// Top-level assignments / constants (before any function)
    pub globals:   Vec<PyStmt>,
    /// Function definitions (setup, loop, and helpers)
    pub functions: Vec<PyFuncDef>,
}