// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: python :: parser
//
//  Recursive-descent parser.  Consumes Vec<PyToken> → PyProgram.
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::{Result, Span, TsukiError};
use super::lexer::{PyToken, PyTokenKind};
use super::ast::*;

pub struct PyParser {
    tokens: Vec<PyToken>,
    pos:    usize,
}

impl PyParser {
    pub fn new(tokens: Vec<PyToken>) -> Self {
        Self { tokens, pos: 0 }
    }

    // ── Core helpers ──────────────────────────────────────────────────────────

    fn peek(&self) -> &PyTokenKind {
        self.tokens.get(self.pos)
            .map(|t| &t.kind)
            .unwrap_or(&PyTokenKind::Eof)
    }

    fn peek_tok(&self) -> &PyToken {
        self.tokens.get(self.pos)
            .unwrap_or(self.tokens.last().unwrap())
    }

    fn span(&self) -> Span {
        self.peek_tok().span.clone()
    }

    fn advance(&mut self) -> &PyToken {
        let tok = &self.tokens[self.pos];
        if self.pos + 1 < self.tokens.len() { self.pos += 1; }
        tok
    }

    fn eat_newlines(&mut self) {
        while matches!(self.peek(), PyTokenKind::Newline | PyTokenKind::Comment(_)) {
            self.advance();
        }
    }

    fn expect(&mut self, expected: &PyTokenKind) -> Result<Span> {
        if self.peek() == expected {
            let sp = self.span();
            self.advance();
            Ok(sp)
        } else {
            Err(TsukiError::Parse {
                msg: format!("expected {:?}, got {:?}", expected, self.peek()),
                span: self.span(),
            })
        }
    }

    fn expect_newline(&mut self) -> Result<()> {
        match self.peek() {
            PyTokenKind::Newline | PyTokenKind::Eof => { self.advance(); Ok(()) }
            PyTokenKind::Comment(_) => { self.advance(); Ok(()) }
            _ => Err(TsukiError::Parse {
                msg: format!("expected newline, got {:?}", self.peek()),
                span: self.span(),
            })
        }
    }

    fn parse_error(&self, msg: impl Into<String>) -> TsukiError {
        TsukiError::Parse { msg: msg.into(), span: self.span() }
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    pub fn parse_program(mut self) -> Result<PyProgram> {
        let mut imports   = Vec::new();
        let mut globals   = Vec::new();
        let mut functions = Vec::new();

        self.eat_newlines();

        while *self.peek() != PyTokenKind::Eof {
            match self.peek() {
                PyTokenKind::Import | PyTokenKind::From => {
                    imports.push(self.parse_import()?);
                }
                PyTokenKind::Def => {
                    functions.push(self.parse_funcdef()?);
                }
                PyTokenKind::Comment(_) | PyTokenKind::Newline => {
                    self.advance();
                }
                _ => {
                    // Global-level statement (assignment, constant, etc.)
                    let stmt = self.parse_stmt()?;
                    globals.push(stmt);
                }
            }
            self.eat_newlines();
        }

        Ok(PyProgram { imports, globals, functions })
    }

    // ── Import parsing ────────────────────────────────────────────────────────

    fn parse_import(&mut self) -> Result<PyImport> {
        let sp = self.span();
        match self.peek() {
            PyTokenKind::Import => {
                self.advance();
                let module = self.parse_dotted_name()?;
                let alias = if let PyTokenKind::Ident(s) = self.peek() {
                    if s == "as" {
                        self.advance();
                        Some(self.parse_ident()?)
                    } else { None }
                } else { None };
                self.expect_newline()?;
                Ok(PyImport { module, alias, names: vec![], span: sp })
            }
            PyTokenKind::From => {
                self.advance();
                let module = self.parse_dotted_name()?;
                if let PyTokenKind::Import = self.peek() {
                    self.advance();
                } else {
                    return Err(self.parse_error("expected 'import' after module name in 'from' import"));
                }
                let mut names = Vec::with_capacity(4);
                if let PyTokenKind::LParen = self.peek() {
                    self.advance();
                    loop {
                        names.push(self.parse_ident()?);
                        if !matches!(self.peek(), PyTokenKind::Comma) { break; }
                        self.advance();
                    }
                    self.expect(&PyTokenKind::RParen)?;
                } else {
                    loop {
                        names.push(self.parse_ident()?);
                        if !matches!(self.peek(), PyTokenKind::Comma) { break; }
                        self.advance();
                    }
                }
                self.expect_newline()?;
                Ok(PyImport { module, alias: None, names, span: sp })
            }
            _ => Err(self.parse_error("expected import statement"))
        }
    }

    fn parse_dotted_name(&mut self) -> Result<String> {
        let mut name = self.parse_ident()?;
        while let PyTokenKind::Dot = self.peek() {
            self.advance();
            name.push('.');
            name.push_str(&self.parse_ident()?);
        }
        Ok(name)
    }

    fn parse_ident(&mut self) -> Result<String> {
        if let PyTokenKind::Ident(s) = self.peek().clone() {
            let s = s.clone();
            self.advance();
            Ok(s)
        } else {
            Err(self.parse_error(format!("expected identifier, got {:?}", self.peek())))
        }
    }

    // ── Function definition ───────────────────────────────────────────────────

    fn parse_funcdef(&mut self) -> Result<PyFuncDef> {
        let sp = self.span();
        self.expect(&PyTokenKind::Def)?;
        let name = self.parse_ident()?;
        self.expect(&PyTokenKind::LParen)?;
        let params = self.parse_params()?;
        self.expect(&PyTokenKind::RParen)?;

        let return_type = if let PyTokenKind::Arrow = self.peek() {
            self.advance();
            Some(self.parse_type_ann()?)
        } else { None };

        self.expect(&PyTokenKind::Colon)?;
        self.expect_newline()?;

        let body = self.parse_block()?;
        Ok(PyFuncDef { name, params, return_type, body, span: sp })
    }

    fn parse_params(&mut self) -> Result<Vec<PyParam>> {
        let mut params = Vec::with_capacity(4);
        while *self.peek() != PyTokenKind::RParen {
            if matches!(self.peek(), PyTokenKind::Star | PyTokenKind::StarStar) {
                // *args / **kwargs — skip for tsuki
                self.advance();
                self.parse_ident().ok();
                if !matches!(self.peek(), PyTokenKind::RParen) {
                    if let PyTokenKind::Comma = self.peek() { self.advance(); }
                }
                continue;
            }
            let name = self.parse_ident()?;
            let ann = if let PyTokenKind::Colon = self.peek() {
                self.advance();
                Some(self.parse_type_ann()?)
            } else { None };
            let default = if let PyTokenKind::Assign = self.peek() {
                self.advance();
                Some(self.parse_expr()?)
            } else { None };
            params.push(PyParam { name, ann, default });
            if !matches!(self.peek(), PyTokenKind::Comma) { break; }
            self.advance();
        }
        Ok(params)
    }

    fn parse_type_ann(&mut self) -> Result<String> {
        // Parse type annotation: simple ident, or ident[...], or ident.ident
        let mut ann = String::new();
        if let PyTokenKind::Ident(s) = self.peek().clone() {
            ann = s.clone();
            self.advance();
        }
        // Handle qualified names (e.g. Optional[int])
        if let PyTokenKind::LBrack = self.peek() {
            ann.push('[');
            self.advance();
            ann.push_str(&self.parse_type_ann()?);
            self.expect(&PyTokenKind::RBrack)?;
            ann.push(']');
        }
        if ann.is_empty() { ann = "auto".into(); }
        Ok(ann)
    }

    // ── Block parsing ─────────────────────────────────────────────────────────

    fn parse_block(&mut self) -> Result<Vec<PyStmt>> {
        self.eat_newlines();
        self.expect(&PyTokenKind::Indent)?;
        let mut stmts = Vec::with_capacity(8);
        loop {
            self.eat_newlines();
            match self.peek() {
                PyTokenKind::Dedent | PyTokenKind::Eof => break,
                _ => stmts.push(self.parse_stmt()?),
            }
        }
        // consume DEDENT if present
        if let PyTokenKind::Dedent = self.peek() { self.advance(); }
        Ok(stmts)
    }

    // ── Statement parsing ─────────────────────────────────────────────────────

    fn parse_stmt(&mut self) -> Result<PyStmt> {
        match self.peek().clone() {
            PyTokenKind::Comment(c) => {
                self.advance();
                Ok(PyStmt::Comment(c))
            }
            PyTokenKind::Return => {
                let sp = self.span();
                self.advance();
                let value = match self.peek() {
                    PyTokenKind::Newline | PyTokenKind::Eof |
                    PyTokenKind::Comment(_) => None,
                    _ => Some(self.parse_expr()?),
                };
                self.expect_newline().ok();
                Ok(PyStmt::Return { value, span: sp })
            }
            PyTokenKind::Pass => {
                let sp = self.span(); self.advance();
                self.expect_newline().ok();
                Ok(PyStmt::Pass(sp))
            }
            PyTokenKind::Break => {
                let sp = self.span(); self.advance();
                self.expect_newline().ok();
                Ok(PyStmt::Break(sp))
            }
            PyTokenKind::Continue => {
                let sp = self.span(); self.advance();
                self.expect_newline().ok();
                Ok(PyStmt::Continue(sp))
            }
            PyTokenKind::Global => {
                let sp = self.span(); self.advance();
                let mut names = vec![self.parse_ident()?];
                while let PyTokenKind::Comma = self.peek() {
                    self.advance();
                    names.push(self.parse_ident()?);
                }
                self.expect_newline().ok();
                Ok(PyStmt::Global { names, span: sp })
            }
            PyTokenKind::If => self.parse_if(),
            PyTokenKind::While => self.parse_while(),
            PyTokenKind::For => self.parse_for(),
            PyTokenKind::Def => {
                // nested function (uncommon in Arduino but valid)
                let fd = self.parse_funcdef()?;
                // Flatten: emit as expression stmt wrapping the function name
                // For now we just drop nested functions — emit a comment
                Ok(PyStmt::Comment(format!("nested def '{}' not supported", fd.name)))
            }
            _ => self.parse_assign_or_expr(),
        }
    }

    fn parse_assign_or_expr(&mut self) -> Result<PyStmt> {
        let sp = self.span();
        let expr = self.parse_expr()?;

        // Check for assignment or augmented assignment
        match self.peek().clone() {
            PyTokenKind::Assign => {
                // Could be a simple assignment or an annotated assignment
                // Extract the target name
                let target = match &expr {
                    PyExpr::Ident(s) => s.clone(),
                    _ => {
                        // Complex target — emit as expression for now
                        self.advance();
                        let _value = self.parse_expr()?;
                        self.expect_newline().ok();
                        return Ok(PyStmt::Expr(expr));
                    }
                };
                self.advance(); // consume '='
                let value = self.parse_expr()?;
                self.expect_newline().ok();
                Ok(PyStmt::Assign { target, ann: None, value: Some(value), span: sp })
            }
            PyTokenKind::Colon => {
                // Annotated assignment: `x: int = 5` or `x: int`
                let target = match &expr {
                    PyExpr::Ident(s) => s.clone(),
                    _ => return Err(TsukiError::Parse {
                        msg: "invalid annotation target".into(), span: sp,
                    }),
                };
                self.advance(); // consume ':'
                let ann = self.parse_type_ann()?;
                let value = if let PyTokenKind::Assign = self.peek() {
                    self.advance();
                    Some(self.parse_expr()?)
                } else { None };
                self.expect_newline().ok();
                Ok(PyStmt::Assign { target, ann: Some(ann), value, span: sp })
            }
            PyTokenKind::PlusEq => {
                let target = match &expr {
                    PyExpr::Ident(s) => s.clone(),
                    _ => return Err(TsukiError::Parse { msg: "invalid augmented assignment target".into(), span: sp }),
                };
                self.advance();
                let value = self.parse_expr()?;
                self.expect_newline().ok();
                Ok(PyStmt::AugAssign { target, op: BinOp::Add, value, span: sp })
            }
            PyTokenKind::MinusEq => {
                let target = match &expr {
                    PyExpr::Ident(s) => s.clone(),
                    _ => return Err(TsukiError::Parse { msg: "invalid augmented assignment target".into(), span: sp }),
                };
                self.advance();
                let value = self.parse_expr()?;
                self.expect_newline().ok();
                Ok(PyStmt::AugAssign { target, op: BinOp::Sub, value, span: sp })
            }
            PyTokenKind::StarEq => {
                let target = match &expr {
                    PyExpr::Ident(s) => s.clone(),
                    _ => return Err(TsukiError::Parse { msg: "invalid augmented assignment target".into(), span: sp }),
                };
                self.advance();
                let value = self.parse_expr()?;
                self.expect_newline().ok();
                Ok(PyStmt::AugAssign { target, op: BinOp::Mul, value, span: sp })
            }
            PyTokenKind::SlashEq => {
                let target = match &expr {
                    PyExpr::Ident(s) => s.clone(),
                    _ => return Err(TsukiError::Parse { msg: "invalid augmented assignment target".into(), span: sp }),
                };
                self.advance();
                let value = self.parse_expr()?;
                self.expect_newline().ok();
                Ok(PyStmt::AugAssign { target, op: BinOp::Div, value, span: sp })
            }
            _ => {
                self.expect_newline().ok();
                Ok(PyStmt::Expr(expr))
            }
        }
    }

    fn parse_if(&mut self) -> Result<PyStmt> {
        let sp = self.span();
        self.expect(&PyTokenKind::If)?;
        let cond = self.parse_expr()?;
        self.expect(&PyTokenKind::Colon)?;
        self.expect_newline()?;
        let body = self.parse_block()?;

        let mut elif_clauses = Vec::new();
        let mut else_body    = Vec::new();

        loop {
            self.eat_newlines();
            match self.peek() {
                PyTokenKind::Elif => {
                    self.advance();
                    let ec = self.parse_expr()?;
                    self.expect(&PyTokenKind::Colon)?;
                    self.expect_newline()?;
                    let eb = self.parse_block()?;
                    elif_clauses.push((ec, eb));
                }
                PyTokenKind::Else => {
                    self.advance();
                    self.expect(&PyTokenKind::Colon)?;
                    self.expect_newline()?;
                    else_body = self.parse_block()?;
                    break;
                }
                _ => break,
            }
        }

        Ok(PyStmt::If { cond, body, elif_clauses, else_body, span: sp })
    }

    fn parse_while(&mut self) -> Result<PyStmt> {
        let sp = self.span();
        self.expect(&PyTokenKind::While)?;
        let cond = self.parse_expr()?;
        self.expect(&PyTokenKind::Colon)?;
        self.expect_newline()?;
        let body = self.parse_block()?;
        Ok(PyStmt::While { cond, body, span: sp })
    }

    fn parse_for(&mut self) -> Result<PyStmt> {
        let sp = self.span();
        self.expect(&PyTokenKind::For)?;
        let var = self.parse_ident()?;
        self.expect(&PyTokenKind::In)?;
        let iter = self.parse_expr()?;
        self.expect(&PyTokenKind::Colon)?;
        self.expect_newline()?;
        let body = self.parse_block()?;
        Ok(PyStmt::For { var, iter, body, span: sp })
    }

    // ── Expression parsing (Pratt / precedence climbing) ─────────────────────

    pub fn parse_expr(&mut self) -> Result<PyExpr> {
        self.parse_or_expr()
    }

    fn parse_or_expr(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_and_expr()?;
        while let PyTokenKind::Or = self.peek() {
            let sp = self.span();
            self.advance();
            let right = self.parse_and_expr()?;
            left = PyExpr::BinOp {
                left: Box::new(left), op: BinOp::Or,
                right: Box::new(right), span: sp,
            };
        }
        Ok(left)
    }

    fn parse_and_expr(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_not_expr()?;
        while let PyTokenKind::And = self.peek() {
            let sp = self.span();
            self.advance();
            let right = self.parse_not_expr()?;
            left = PyExpr::BinOp {
                left: Box::new(left), op: BinOp::And,
                right: Box::new(right), span: sp,
            };
        }
        Ok(left)
    }

    fn parse_not_expr(&mut self) -> Result<PyExpr> {
        if let PyTokenKind::Not = self.peek() {
            let sp = self.span();
            self.advance();
            let operand = self.parse_not_expr()?;
            return Ok(PyExpr::UnaryOp { op: UnaryOp::Not, operand: Box::new(operand), span: sp });
        }
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_bitor()?;
        loop {
            let op = match self.peek() {
                PyTokenKind::Eq    => BinOp::Eq,
                PyTokenKind::NotEq => BinOp::NotEq,
                PyTokenKind::Lt    => BinOp::Lt,
                PyTokenKind::Gt    => BinOp::Gt,
                PyTokenKind::LtEq  => BinOp::LtEq,
                PyTokenKind::GtEq  => BinOp::GtEq,
                _ => break,
            };
            let sp = self.span();
            self.advance();
            let right = self.parse_bitor()?;
            left = PyExpr::BinOp { left: Box::new(left), op, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_bitor(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_bitxor()?;
        while let PyTokenKind::Pipe = self.peek() {
            let sp = self.span(); self.advance();
            let right = self.parse_bitxor()?;
            left = PyExpr::BinOp { left: Box::new(left), op: BinOp::BitOr, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_bitxor(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_bitand()?;
        while let PyTokenKind::Caret = self.peek() {
            let sp = self.span(); self.advance();
            let right = self.parse_bitand()?;
            left = PyExpr::BinOp { left: Box::new(left), op: BinOp::BitXor, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_bitand(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_shift()?;
        while let PyTokenKind::Amp = self.peek() {
            let sp = self.span(); self.advance();
            let right = self.parse_shift()?;
            left = PyExpr::BinOp { left: Box::new(left), op: BinOp::BitAnd, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_shift(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_additive()?;
        loop {
            let op = match self.peek() {
                PyTokenKind::LShift => BinOp::LShift,
                PyTokenKind::RShift => BinOp::RShift,
                _ => break,
            };
            let sp = self.span(); self.advance();
            let right = self.parse_additive()?;
            left = PyExpr::BinOp { left: Box::new(left), op, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_additive(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let op = match self.peek() {
                PyTokenKind::Plus  => BinOp::Add,
                PyTokenKind::Minus => BinOp::Sub,
                _ => break,
            };
            let sp = self.span(); self.advance();
            let right = self.parse_multiplicative()?;
            left = PyExpr::BinOp { left: Box::new(left), op, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<PyExpr> {
        let mut left = self.parse_unary()?;
        loop {
            let op = match self.peek() {
                PyTokenKind::Star      => BinOp::Mul,
                PyTokenKind::Slash     => BinOp::Div,
                PyTokenKind::SlashSlash => BinOp::FloorDiv,
                PyTokenKind::Percent   => BinOp::Mod,
                PyTokenKind::StarStar  => BinOp::Pow,
                _ => break,
            };
            let sp = self.span(); self.advance();
            let right = self.parse_unary()?;
            left = PyExpr::BinOp { left: Box::new(left), op, right: Box::new(right), span: sp };
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<PyExpr> {
        match self.peek().clone() {
            PyTokenKind::Minus => {
                let sp = self.span(); self.advance();
                let operand = self.parse_unary()?;
                Ok(PyExpr::UnaryOp { op: UnaryOp::Neg, operand: Box::new(operand), span: sp })
            }
            PyTokenKind::Tilde => {
                let sp = self.span(); self.advance();
                let operand = self.parse_unary()?;
                Ok(PyExpr::UnaryOp { op: UnaryOp::BitNot, operand: Box::new(operand), span: sp })
            }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> Result<PyExpr> {
        let mut expr = self.parse_atom()?;
        loop {
            match self.peek().clone() {
                PyTokenKind::Dot => {
                    let sp = self.span(); self.advance();
                    let attr = self.parse_ident()?;
                    expr = PyExpr::Attr { obj: Box::new(expr), attr, span: sp };
                }
                PyTokenKind::LParen => {
                    let sp = self.span(); self.advance();
                    let args = self.parse_call_args()?;
                    self.expect(&PyTokenKind::RParen)?;
                    expr = PyExpr::Call { func: Box::new(expr), args, span: sp };
                }
                PyTokenKind::LBrack => {
                    let sp = self.span(); self.advance();
                    let index = self.parse_expr()?;
                    self.expect(&PyTokenKind::RBrack)?;
                    expr = PyExpr::Subscript { obj: Box::new(expr), index: Box::new(index), span: sp };
                }
                _ => break,
            }
        }
        Ok(expr)
    }

    fn parse_call_args(&mut self) -> Result<Vec<PyExpr>> {
        let mut args = Vec::with_capacity(4);
        while *self.peek() != PyTokenKind::RParen && *self.peek() != PyTokenKind::Eof {
            // Skip keyword arguments: name=value → just use the value
            if matches!(self.peek(), PyTokenKind::Ident(_)) {
                // peek ahead for '='
                let saved = self.pos;
                self.advance();
                if let PyTokenKind::Assign = self.peek() {
                    self.advance(); // skip '='
                    args.push(self.parse_expr()?);
                } else {
                    self.pos = saved;
                    args.push(self.parse_expr()?);
                }
            } else {
                args.push(self.parse_expr()?);
            }
            if !matches!(self.peek(), PyTokenKind::Comma) { break; }
            self.advance();
        }
        Ok(args)
    }

    fn parse_atom(&mut self) -> Result<PyExpr> {
        let sp = self.span();
        match self.peek().clone() {
            PyTokenKind::Int(v) => { self.advance(); Ok(PyExpr::Int(v)) }
            PyTokenKind::Float(v) => { self.advance(); Ok(PyExpr::Float(v)) }
            PyTokenKind::Bool(b) => { self.advance(); Ok(PyExpr::Bool(b)) }
            PyTokenKind::None => { self.advance(); Ok(PyExpr::None) }
            PyTokenKind::Str(s) => {
                self.advance();
                // Concatenate adjacent string literals
                let mut full = s.clone();
                while let PyTokenKind::Str(s2) = self.peek().clone() {
                    self.advance();
                    full.push_str(&s2);
                }
                Ok(PyExpr::Str(full))
            }
            PyTokenKind::Ident(s) => {
                self.advance();
                Ok(PyExpr::Ident(s))
            }
            PyTokenKind::LParen => {
                self.advance();
                let expr = self.parse_expr()?;
                // Handle tuples
                if let PyTokenKind::Comma = self.peek() {
                    let mut elems = vec![expr];
                    while let PyTokenKind::Comma = self.peek() {
                        self.advance();
                        if *self.peek() == PyTokenKind::RParen { break; }
                        elems.push(self.parse_expr()?);
                    }
                    self.expect(&PyTokenKind::RParen)?;
                    Ok(PyExpr::List(elems))
                } else {
                    self.expect(&PyTokenKind::RParen)?;
                    Ok(expr)
                }
            }
            PyTokenKind::LBrack => {
                self.advance();
                let mut elems = Vec::with_capacity(4);
                while *self.peek() != PyTokenKind::RBrack && *self.peek() != PyTokenKind::Eof {
                    elems.push(self.parse_expr()?);
                    if !matches!(self.peek(), PyTokenKind::Comma) { break; }
                    self.advance();
                }
                self.expect(&PyTokenKind::RBrack)?;
                Ok(PyExpr::List(elems))
            }
            other => Err(TsukiError::Parse {
                msg: format!("unexpected token in expression: {:?}", other),
                span: sp,
            }),
        }
    }
}