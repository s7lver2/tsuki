// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: parser
//  Recursive-descent parser: Vec<Token> → Program AST
// ─────────────────────────────────────────────────────────────────────────────

pub mod ast;
pub use ast::*;

use crate::error::{GodotinoError, Result, Span};
use crate::lexer::token::{Token, TokenKind};

// ─────────────────────────────────────────────────────────────────────────────

pub struct Parser {
    tokens: Vec<Token>,
    pos:    usize,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

impl Parser {
    pub fn new(mut tokens: Vec<Token>) -> Self {
        // Drop newlines — we don't implement full Go ASI (simplified)
        tokens.retain(|t| !matches!(t.kind, TokenKind::Newline | TokenKind::Semicolon));
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.pos.min(self.tokens.len().saturating_sub(1))]
    }

    fn peek_kind(&self) -> &TokenKind { &self.peek().kind }

    fn span(&self) -> Span { self.peek().span.clone() }

    fn advance(&mut self) -> &Token {
        let t = &self.tokens[self.pos.min(self.tokens.len().saturating_sub(1))];
        if self.pos + 1 < self.tokens.len() { self.pos += 1; }
        t
    }

    fn at(&self, kind: &TokenKind) -> bool {
        std::mem::discriminant(self.peek_kind()) == std::mem::discriminant(kind)
    }

    fn eat(&mut self, kind: &TokenKind) -> bool {
        if self.at(kind) { self.advance(); true } else { false }
    }

    fn expect(&mut self, kind: &TokenKind) -> Result<Span> {
        if self.at(kind) {
            let sp = self.span();
            self.advance();
            Ok(sp)
        } else {
            Err(GodotinoError::parse(
                self.span(),
                format!("expected `{:?}`, found `{:?}`", kind, self.peek_kind()),
            ))
        }
    }

    fn expect_ident(&mut self) -> Result<String> {
        match self.peek_kind().clone() {
            TokenKind::Ident(s) => { self.advance(); Ok(s) }
            _ => Err(GodotinoError::parse(
                self.span(),
                format!("expected identifier, found `{:?}`", self.peek_kind()),
            )),
        }
    }

    fn eof(&self) -> bool { self.peek_kind() == &TokenKind::EOF }

    // lookahead: is token at offset `off` a type-start?
    fn is_type_start_at(&self, off: usize) -> bool {
        let idx = (self.pos + off).min(self.tokens.len().saturating_sub(1));
        matches!(&self.tokens[idx].kind,
            TokenKind::Ident(_)    | TokenKind::Star      |
            TokenKind::LBracket    | TokenKind::KwMap      |
            TokenKind::KwFunc      | TokenKind::KwChan     |
            TokenKind::KwInterface | TokenKind::KwStruct)
    }
}

// ── Public entry ──────────────────────────────────────────────────────────────

impl Parser {
    pub fn parse_program(&mut self) -> Result<Program> {
        self.expect(&TokenKind::KwPackage)?;
        let package = self.expect_ident()?;

        let mut imports = Vec::new();
        while self.at(&TokenKind::KwImport) {
            imports.extend(self.parse_imports()?);
        }

        let mut decls = Vec::new();
        while !self.eof() {
            decls.push(self.parse_top_decl()?);
        }

        Ok(Program { package, imports, decls })
    }

    // ── Imports ───────────────────────────────────────────────────────────────

    fn parse_imports(&mut self) -> Result<Vec<Import>> {
        self.expect(&TokenKind::KwImport)?;
        let mut list = Vec::new();
        if self.eat(&TokenKind::LParen) {
            while !self.at(&TokenKind::RParen) && !self.eof() {
                list.push(self.parse_import_spec()?);
            }
            self.expect(&TokenKind::RParen)?;
        } else {
            list.push(self.parse_import_spec()?);
        }
        Ok(list)
    }

    fn parse_import_spec(&mut self) -> Result<Import> {
        let alias = match self.peek_kind().clone() {
            TokenKind::Ident(s) if !matches!(self.tokens.get(self.pos + 1).map(|t| &t.kind),
                Some(TokenKind::LitString(_)) | None) => None,
            TokenKind::Ident(s) => { self.advance(); Some(s) }
            TokenKind::Dot      => { self.advance(); Some(".".into()) }
            _ => None,
        };
        let path = match self.peek_kind().clone() {
            TokenKind::LitString(s) => { self.advance(); s }
            _ => return Err(GodotinoError::parse(self.span(), "expected import path string")),
        };
        Ok(Import { alias, path })
    }

    // ── Top-level declarations ────────────────────────────────────────────────

    fn parse_top_decl(&mut self) -> Result<Decl> {
        match self.peek_kind().clone() {
            TokenKind::KwFunc  => self.parse_func_decl(),
            TokenKind::KwType  => self.parse_type_decl(),
            TokenKind::KwVar   => self.parse_var_decl_top(),
            TokenKind::KwConst => self.parse_const_decl_top(),
            _ => Err(GodotinoError::parse(
                self.span(),
                format!("unexpected top-level token `{:?}`", self.peek_kind()),
            )),
        }
    }

    // ── Function ──────────────────────────────────────────────────────────────

    fn parse_func_decl(&mut self) -> Result<Decl> {
        let span = self.span();
        self.expect(&TokenKind::KwFunc)?;

        let recv = if self.eat(&TokenKind::LParen) {
            let name = if self.at(&TokenKind::Ident("".into())) && self.is_type_start_at(1) {
                Some(self.expect_ident()?)
            } else { None };
            let ty = self.parse_type()?;
            self.expect(&TokenKind::RParen)?;
            Some(FuncParam { name, ty, variadic: false })
        } else { None };

        let name = self.expect_ident()?;
        let sig  = self.parse_func_sig()?;
        let body = if self.at(&TokenKind::LBrace) { Some(self.parse_block()?) } else { None };

        Ok(Decl::Func { name, recv, sig, body, span })
    }

    fn parse_func_sig(&mut self) -> Result<FuncSig> {
        let params  = self.parse_param_list()?;
        let results = self.parse_result_list()?;
        Ok(FuncSig { params, results })
    }

    fn parse_param_list(&mut self) -> Result<Vec<FuncParam>> {
        self.expect(&TokenKind::LParen)?;
        let mut params = Vec::new();
        while !self.at(&TokenKind::RParen) && !self.eof() {
            let variadic = self.eat(&TokenKind::Ellipsis);
            // named param?
            let name = if self.at(&TokenKind::Ident("".into())) && self.is_type_start_at(1) {
                Some(self.expect_ident()?)
            } else { None };
            let variadic2 = variadic || self.eat(&TokenKind::Ellipsis);
            let ty = self.parse_type()?;
            params.push(FuncParam { name, ty, variadic: variadic2 });
            if !self.eat(&TokenKind::Comma) { break; }
        }
        self.expect(&TokenKind::RParen)?;
        Ok(params)
    }

    fn parse_result_list(&mut self) -> Result<Vec<FuncParam>> {
        if self.at(&TokenKind::LBrace) || self.eof() {
            return Ok(vec![]);
        }
        if self.at(&TokenKind::LParen) {
            return self.parse_param_list();
        }
        // single unnamed return type
        let ty = self.parse_type()?;
        Ok(vec![FuncParam { name: None, ty, variadic: false }])
    }

    // ── Type declarations ─────────────────────────────────────────────────────

    fn parse_type_decl(&mut self) -> Result<Decl> {
        let span = self.span();
        self.expect(&TokenKind::KwType)?;
        let name = self.expect_ident()?;
        if self.at(&TokenKind::KwStruct) {
            self.advance();
            self.expect(&TokenKind::LBrace)?;
            let mut fields = Vec::new();
            while !self.at(&TokenKind::RBrace) && !self.eof() {
                let fname = self.expect_ident()?;
                let fty   = self.parse_type()?;
                let tag   = if let TokenKind::LitString(s) = self.peek_kind().clone() {
                    self.advance(); Some(s)
                } else { None };
                fields.push(Field { name: Some(fname), ty: fty, tag });
            }
            self.expect(&TokenKind::RBrace)?;
            Ok(Decl::StructDef { name, fields, span })
        } else {
            let ty = self.parse_type()?;
            Ok(Decl::TypeDef { name, ty, span })
        }
    }

    fn parse_var_decl_top(&mut self) -> Result<Decl> {
        let span = self.span();
        self.expect(&TokenKind::KwVar)?;
        let name = self.expect_ident()?;
        let ty   = if !self.at(&TokenKind::Assign) { Some(self.parse_type()?) } else { None };
        let init = if self.eat(&TokenKind::Assign)  { Some(self.parse_expr(0)?) } else { None };
        Ok(Decl::Var { name, ty, init, span })
    }

    fn parse_const_decl_top(&mut self) -> Result<Decl> {
        let span = self.span();
        self.expect(&TokenKind::KwConst)?;
        let name = self.expect_ident()?;
        let ty   = if !self.at(&TokenKind::Assign) { Some(self.parse_type()?) } else { None };
        self.expect(&TokenKind::Assign)?;
        let val  = self.parse_expr(0)?;
        Ok(Decl::Const { name, ty, val, span })
    }

    // ── Types ─────────────────────────────────────────────────────────────────

    fn parse_type(&mut self) -> Result<Type> {
        match self.peek_kind().clone() {
            // Pointer
            TokenKind::Star => { self.advance(); Ok(Type::Ptr(Box::new(self.parse_type()?))) }

            // Array / slice
            TokenKind::LBracket => {
                self.advance();
                if self.eat(&TokenKind::RBracket) {
                    // []T
                    Ok(Type::Slice(Box::new(self.parse_type()?)))
                } else {
                    // [N]T
                    let len = match self.peek_kind().clone() {
                        TokenKind::LitInt(n) => { self.advance(); Some(n as usize) }
                        _ => None,
                    };
                    self.expect(&TokenKind::RBracket)?;
                    Ok(Type::Array { len, elem: Box::new(self.parse_type()?) })
                }
            }

            // Map
            TokenKind::KwMap => {
                self.advance();
                self.expect(&TokenKind::LBracket)?;
                let key = self.parse_type()?;
                self.expect(&TokenKind::RBracket)?;
                let val = self.parse_type()?;
                Ok(Type::Map { key: Box::new(key), val: Box::new(val) })
            }

            // Chan
            TokenKind::KwChan => {
                self.advance();
                let dir = if self.eat(&TokenKind::Arrow) { ChanDir::Send } else { ChanDir::Both };
                Ok(Type::Chan { dir, elem: Box::new(self.parse_type()?) })
            }
            TokenKind::Arrow => {
                self.advance();
                self.expect(&TokenKind::KwChan)?;
                Ok(Type::Chan { dir: ChanDir::Recv, elem: Box::new(self.parse_type()?) })
            }

            // Func type
            TokenKind::KwFunc => {
                self.advance();
                let sig = self.parse_func_sig()?;
                let params  = sig.params.into_iter().map(|p| p.ty).collect();
                let results = sig.results.into_iter().map(|p| p.ty).collect();
                Ok(Type::Func { params, results })
            }

            // Interface (empty or with methods — simplified)
            TokenKind::KwInterface => {
                self.advance();
                self.expect(&TokenKind::LBrace)?;
                self.expect(&TokenKind::RBrace)?;
                Ok(Type::Iface(vec![]))
            }

            // Struct (inline)
            TokenKind::KwStruct => {
                self.advance();
                self.expect(&TokenKind::LBrace)?;
                let mut fields = Vec::new();
                while !self.at(&TokenKind::RBrace) && !self.eof() {
                    let n = self.expect_ident()?;
                    let t = self.parse_type()?;
                    fields.push(Field { name: Some(n), ty: t, tag: None });
                }
                self.expect(&TokenKind::RBrace)?;
                Ok(Type::Struct(fields))
            }

            // Named / builtin
            TokenKind::Ident(name) => {
                self.advance();
                // qualified: pkg.Type
                if self.eat(&TokenKind::Dot) {
                    let sub = self.expect_ident()?;
                    return Ok(Type::Named(format!("{}.{}", name, sub)));
                }
                Ok(builtin_type(&name))
            }

            _ => Err(GodotinoError::parse(
                self.span(),
                format!("expected type, found `{:?}`", self.peek_kind()),
            )),
        }
    }

    // ── Block & statements ────────────────────────────────────────────────────

    fn parse_block(&mut self) -> Result<Block> {
        let span = self.span();
        self.expect(&TokenKind::LBrace)?;
        let mut stmts = Vec::new();
        while !self.at(&TokenKind::RBrace) && !self.eof() {
            stmts.push(self.parse_stmt()?);
        }
        self.expect(&TokenKind::RBrace)?;
        Ok(Block { stmts, span })
    }

    fn parse_stmt(&mut self) -> Result<Stmt> {
        let span = self.span();
        match self.peek_kind().clone() {
            TokenKind::KwVar      => self.parse_var_stmt(),
            TokenKind::KwConst    => self.parse_const_stmt(),
            TokenKind::KwReturn   => self.parse_return(),
            TokenKind::KwIf       => self.parse_if(),
            TokenKind::KwFor      => self.parse_for(),
            TokenKind::KwSwitch   => self.parse_switch(),
            TokenKind::KwBreak    => { self.advance(); Ok(Stmt::Break    { label: None, span }) }
            TokenKind::KwContinue => { self.advance(); Ok(Stmt::Continue { label: None, span }) }
            TokenKind::KwGoto     => { self.advance(); Ok(Stmt::Goto     { label: self.expect_ident()?, span }) }
            TokenKind::KwDefer    => { self.advance(); Ok(Stmt::Defer    { call:  self.parse_expr(0)?, span }) }
            TokenKind::KwGo       => { self.advance(); Ok(Stmt::Go       { call:  self.parse_expr(0)?, span }) }
            TokenKind::LBrace     => Ok(Stmt::Block(self.parse_block()?)),
            _                     => self.parse_simple_stmt(),
        }
    }

    fn parse_var_stmt(&mut self) -> Result<Stmt> {
        let span = self.span();
        self.expect(&TokenKind::KwVar)?;
        let name = self.expect_ident()?;
        let ty   = if !self.at(&TokenKind::Assign) { Some(self.parse_type()?) } else { None };
        let init = if self.eat(&TokenKind::Assign)  { Some(self.parse_expr(0)?) } else { None };
        Ok(Stmt::VarDecl { name, ty, init, span })
    }

    fn parse_const_stmt(&mut self) -> Result<Stmt> {
        let span = self.span();
        self.expect(&TokenKind::KwConst)?;
        let name = self.expect_ident()?;
        let ty   = if !self.at(&TokenKind::Assign) { Some(self.parse_type()?) } else { None };
        self.expect(&TokenKind::Assign)?;
        let val  = self.parse_expr(0)?;
        Ok(Stmt::ConstDecl { name, ty, val, span })
    }

    fn parse_return(&mut self) -> Result<Stmt> {
        let span = self.span();
        self.expect(&TokenKind::KwReturn)?;
        let mut vals = Vec::new();
        if !self.at(&TokenKind::RBrace) && !self.eof() {
            vals.push(self.parse_expr(0)?);
            while self.eat(&TokenKind::Comma) { vals.push(self.parse_expr(0)?); }
        }
        Ok(Stmt::Return { vals, span })
    }

    fn parse_if(&mut self) -> Result<Stmt> {
        let span = self.span();
        self.expect(&TokenKind::KwIf)?;
        let cond  = self.parse_expr(0)?;
        let then  = self.parse_block()?;
        let else_ = if self.eat(&TokenKind::KwElse) {
            Some(Box::new(if self.at(&TokenKind::KwIf) {
                self.parse_if()?
            } else {
                Stmt::Block(self.parse_block()?)
            }))
        } else { None };
        Ok(Stmt::If { init: None, cond, then, else_, span })
    }

    fn parse_for(&mut self) -> Result<Stmt> {
        let span = self.span();
        self.expect(&TokenKind::KwFor)?;

        // infinite loop
        if self.at(&TokenKind::LBrace) {
            return Ok(Stmt::For { init: None, cond: None, post: None, body: self.parse_block()?, span });
        }

        // check for range
        if self.has_range_keyword_ahead() {
            return self.parse_range(span);
        }

        // while-style: `for cond { }`
        let cond = self.parse_expr(0)?;
        Ok(Stmt::For { init: None, cond: Some(cond), post: None, body: self.parse_block()?, span })
    }

    fn has_range_keyword_ahead(&self) -> bool {
        let mut i = self.pos;
        while i < self.tokens.len() {
            match &self.tokens[i].kind {
                TokenKind::KwRange => return true,
                TokenKind::LBrace | TokenKind::EOF => return false,
                _ => i += 1,
            }
        }
        false
    }

    fn parse_range(&mut self, span: Span) -> Result<Stmt> {
        // for k, v := range expr { }
        // for k := range expr { }
        // for range expr { }
        let (key, val) = if self.at(&TokenKind::KwRange) {
            (None, None)
        } else {
            let k = self.expect_ident()?;
            let v = if self.eat(&TokenKind::Comma) { Some(self.expect_ident()?) } else { None };
            self.expect(&TokenKind::DeclAssign)?;
            (Some(k), v)
        };
        self.expect(&TokenKind::KwRange)?;
        let iter = self.parse_expr(0)?;
        let body = self.parse_block()?;
        Ok(Stmt::Range { key, val, iter, body, span })
    }

    fn parse_switch(&mut self) -> Result<Stmt> {
        let span = self.span();
        self.expect(&TokenKind::KwSwitch)?;
        let tag = if !self.at(&TokenKind::LBrace) { Some(self.parse_expr(0)?) } else { None };
        self.expect(&TokenKind::LBrace)?;

        let mut cases = Vec::new();
        while !self.at(&TokenKind::RBrace) && !self.eof() {
            let cspan = self.span();
            let exprs = if self.eat(&TokenKind::KwCase) {
                let mut es = vec![self.parse_expr(0)?];
                while self.eat(&TokenKind::Comma) { es.push(self.parse_expr(0)?); }
                self.expect(&TokenKind::Colon)?;
                es
            } else {
                self.expect(&TokenKind::KwDefault)?;
                self.expect(&TokenKind::Colon)?;
                vec![]
            };
            let mut body = Vec::new();
            while !self.at(&TokenKind::KwCase) && !self.at(&TokenKind::KwDefault)
                && !self.at(&TokenKind::RBrace) && !self.eof()
            {
                body.push(self.parse_stmt()?);
            }
            cases.push(SwitchCase { exprs, body, span: cspan });
        }
        self.expect(&TokenKind::RBrace)?;
        Ok(Stmt::Switch { init: None, tag, cases, span })
    }

    fn parse_simple_stmt(&mut self) -> Result<Stmt> {
        let span = self.span();
        let expr = self.parse_expr(0)?;

        // short declaration: names := exprs
        if self.at(&TokenKind::DeclAssign) {
            self.advance();
            let names = expr_list_to_names(&[expr], &span)?;
            let mut vals = vec![self.parse_expr(0)?];
            while self.eat(&TokenKind::Comma) { vals.push(self.parse_expr(0)?); }
            return Ok(Stmt::ShortDecl { names, vals, span });
        }

        // assignment: lhs op= rhs
        if let Some(op_str) = self.peek_kind().as_assign_op() {
            let op = parse_assign_op(op_str);
            self.advance();
            let lhs = vec![expr];
            // collect additional lhs after comma (multi-assign)
            // (they were parsed as binary exprs before the op — simplification)
            let mut rhs = vec![self.parse_expr(0)?];
            while self.eat(&TokenKind::Comma) { rhs.push(self.parse_expr(0)?); }
            return Ok(Stmt::Assign { lhs, rhs, op, span });
        }

        if self.eat(&TokenKind::Inc) { return Ok(Stmt::Inc { expr, span }); }
        if self.eat(&TokenKind::Dec) { return Ok(Stmt::Dec { expr, span }); }

        Ok(Stmt::Expr { expr, span })
    }

    // ── Expressions (Pratt) ───────────────────────────────────────────────────

    fn parse_expr(&mut self, min_prec: u8) -> Result<Expr> {
        let mut lhs = self.parse_unary()?;
        loop {
            let Some((prec, op_str)) = self.peek_kind().as_binary_op() else { break };
            if prec < min_prec { break; }
            let span = self.span();
            self.advance();
            let rhs = self.parse_expr(prec + 1)?;
            lhs = Expr::Binary {
                op:  parse_bin_op(op_str),
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
                span,
            };
        }
        Ok(lhs)
    }

    fn parse_unary(&mut self) -> Result<Expr> {
        let span = self.span();
        let op = match self.peek_kind() {
            TokenKind::Minus => Some(UnOp::Neg),
            TokenKind::Bang  => Some(UnOp::Not),
            TokenKind::Caret => Some(UnOp::BitNot),
            TokenKind::Star  => Some(UnOp::Deref),
            TokenKind::Amp   => Some(UnOp::Addr),
            TokenKind::Arrow => Some(UnOp::Recv),
            _ => None,
        };
        if let Some(op) = op {
            self.advance();
            return Ok(Expr::Unary { op, expr: Box::new(self.parse_unary()?), span });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> Result<Expr> {
        let mut expr = self.parse_primary()?;
        loop {
            let span = self.span();
            match self.peek_kind().clone() {
                // call
                TokenKind::LParen => {
                    self.advance();
                    let mut args = Vec::new();
                    while !self.at(&TokenKind::RParen) && !self.eof() {
                        self.eat(&TokenKind::Ellipsis);
                        args.push(self.parse_expr(0)?);
                        if !self.eat(&TokenKind::Comma) { break; }
                    }
                    self.expect(&TokenKind::RParen)?;
                    expr = Expr::Call { func: Box::new(expr), args, span };
                }
                // index / slice
                TokenKind::LBracket => {
                    self.advance();
                    let lo = if !self.at(&TokenKind::Colon) {
                        Some(Box::new(self.parse_expr(0)?))
                    } else { None };
                    if self.eat(&TokenKind::Colon) {
                        let hi = if !self.at(&TokenKind::RBracket) {
                            Some(Box::new(self.parse_expr(0)?))
                        } else { None };
                        self.expect(&TokenKind::RBracket)?;
                        expr = Expr::Slice { expr: Box::new(expr), lo, hi, span };
                    } else {
                        self.expect(&TokenKind::RBracket)?;
                        expr = Expr::Index { expr: Box::new(expr), idx: lo.unwrap(), span };
                    }
                }
                // selector / type-assert
                TokenKind::Dot => {
                    self.advance();
                    if self.eat(&TokenKind::LParen) {
                        let ty = self.parse_type()?;
                        self.expect(&TokenKind::RParen)?;
                        expr = Expr::TypeAssert { expr: Box::new(expr), ty, span };
                    } else {
                        let field = self.expect_ident()?;
                        expr = Expr::Select { expr: Box::new(expr), field, span };
                    }
                }
                _ => break,
            }
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<Expr> {
        let span = self.span();
        match self.peek_kind().clone() {
            TokenKind::LitInt(n)    => { self.advance(); Ok(Expr::Int(n)) }
            TokenKind::LitFloat(f)  => { self.advance(); Ok(Expr::Float(f)) }
            TokenKind::LitString(s) => { self.advance(); Ok(Expr::Str(s)) }
            TokenKind::LitRune(c)   => { self.advance(); Ok(Expr::Rune(c)) }
            TokenKind::LitBool(b)   => { self.advance(); Ok(Expr::Bool(b)) }
            TokenKind::KwNil        => { self.advance(); Ok(Expr::Nil) }

            TokenKind::LParen => {
                self.advance();
                let e = self.parse_expr(0)?;
                self.expect(&TokenKind::RParen)?;
                Ok(e)
            }

            TokenKind::KwFunc => {
                self.advance();
                let sig  = self.parse_func_sig()?;
                let body = self.parse_block()?;
                Ok(Expr::FuncLit { sig, body, span })
            }

            TokenKind::Ident(name) => {
                self.advance();
                // composite literal: TypeName{...}
                if self.at(&TokenKind::LBrace) {
                    return self.parse_composite(Type::Named(name), span);
                }
                Ok(Expr::Ident { name, span })
            }

            TokenKind::LBracket | TokenKind::KwMap | TokenKind::KwStruct => {
                let ty = self.parse_type()?;
                self.parse_composite(ty, span)
            }

            _ => Err(GodotinoError::parse(
                span,
                format!("unexpected token in expression: `{:?}`", self.peek_kind()),
            )),
        }
    }

    fn parse_composite(&mut self, ty: Type, span: Span) -> Result<Expr> {
        self.expect(&TokenKind::LBrace)?;
        let mut elems = Vec::new();
        while !self.at(&TokenKind::RBrace) && !self.eof() {
            let first = self.parse_expr(0)?;
            let (key, val) = if self.eat(&TokenKind::Colon) {
                (Some(first), self.parse_expr(0)?)
            } else {
                (None, first)
            };
            elems.push(CompElem { key, val });
            if !self.eat(&TokenKind::Comma) { break; }
        }
        self.expect(&TokenKind::RBrace)?;
        Ok(Expr::Composite { ty, elems, span })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn builtin_type(s: &str) -> Type {
    match s {
        "bool"       => Type::Bool,
        "int"        => Type::Int,    "int8"    => Type::Int8,
        "int16"      => Type::Int16,  "int32"   => Type::Int32,
        "int64"      => Type::Int64,
        "uint"       => Type::Uint,   "uint8"   => Type::Uint8,
        "uint16"     => Type::Uint16, "uint32"  => Type::Uint32,
        "uint64"     => Type::Uint64, "uintptr" => Type::Uintptr,
        "float32"    => Type::Float32,"float64" => Type::Float64,
        "byte"       => Type::Byte,   "rune"    => Type::Rune,
        "string"     => Type::String,
        n            => Type::Named(n.to_owned()),
    }
}

fn parse_bin_op(op: &str) -> BinOp {
    match op {
        "+"  => BinOp::Add,  "-"  => BinOp::Sub, "*"  => BinOp::Mul,
        "/"  => BinOp::Div,  "%"  => BinOp::Rem,
        "&&" => BinOp::And,  "||" => BinOp::Or,
        "&"  => BinOp::BitAnd, "|" => BinOp::BitOr, "^" => BinOp::BitXor,
        "&~" => BinOp::BitAndNot, "<<" => BinOp::Shl, ">>" => BinOp::Shr,
        "==" => BinOp::Eq,  "!=" => BinOp::Ne,
        "<"  => BinOp::Lt,  "<=" => BinOp::Le,
        ">"  => BinOp::Gt,  ">=" => BinOp::Ge,
        _    => BinOp::Add,
    }
}

fn parse_assign_op(op: &str) -> AssignOp {
    match op {
        "="   => AssignOp::Plain, "+="  => AssignOp::Add,
        "-="  => AssignOp::Sub,   "*="  => AssignOp::Mul,
        "/="  => AssignOp::Div,   "%="  => AssignOp::Rem,
        "&="  => AssignOp::BitAnd,"^="  => AssignOp::BitXor,
        "|="  => AssignOp::BitOr, "<<=" => AssignOp::Shl,
        ">>=" => AssignOp::Shr,   _     => AssignOp::Plain,
    }
}

fn expr_list_to_names(exprs: &[Expr], span: &Span) -> Result<Vec<String>> {
    exprs.iter().map(|e| match e {
        Expr::Ident { name, .. } => Ok(name.clone()),
        _ => Err(GodotinoError::parse(span.clone(), "left side of `:=` must be identifiers")),
    }).collect()
}