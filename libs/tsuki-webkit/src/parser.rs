// tsuki-webkit — parser.rs
// Parses the token stream into a lightweight JSX AST.

use crate::error::WebkitError;
use crate::lexer::{Tok, Token};

// ── AST node types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct JsxAttr {
    pub name:  String,
    pub value: Option<AttrValue>,
}

#[derive(Debug, Clone)]
pub enum AttrValue {
    Str(String),
    Expr(String),   // raw JS expression inside {}
}

#[derive(Debug, Clone)]
pub enum JsxNode {
    Element {
        tag:      String,
        attrs:    Vec<JsxAttr>,
        children: Vec<JsxNode>,
    },
    Text(String),
    Expr(String),    // {expression}
    Fragment(Vec<JsxNode>),
}

#[derive(Debug, Clone)]
pub struct ImportDecl {
    pub names:  Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct Module {
    pub imports:    Vec<ImportDecl>,
    pub jsx_root:   Option<JsxNode>,
    /// Raw JS statements outside JSX (event handlers, state, etc.)
    pub js_stmts:   Vec<String>,
}

// ── Parser ────────────────────────────────────────────────────────────────────

struct Parser {
    tokens: Vec<Tok>,
    pos:    usize,
}

impl Parser {
    fn new(tokens: Vec<Tok>) -> Self { Self { tokens, pos: 0 } }

    fn peek(&self) -> &Token { &self.tokens[self.pos].kind }
    fn line(&self) -> usize  { self.tokens[self.pos].span.line }

    fn advance(&mut self) -> Token {
        let tok = self.tokens[self.pos].kind.clone();
        if self.pos + 1 < self.tokens.len() { self.pos += 1; }
        tok
    }

    fn eat(&mut self, expected: &Token) -> Result<(), WebkitError> {
        if self.peek() == expected {
            self.advance();
            Ok(())
        } else {
            Err(WebkitError::ParseError {
                msg:  format!("expected {expected:?}, got {:?}", self.peek()),
                line: self.line(),
            })
        }
    }

    fn eat_ident(&mut self) -> Result<String, WebkitError> {
        match self.advance() {
            Token::Ident(s) => Ok(s),
            other => Err(WebkitError::ParseError {
                msg: format!("expected identifier, got {other:?}"),
                line: self.line(),
            }),
        }
    }

    // ── Import statement ─────────────────────────────────────────────────────
    // import { Api, Json } from 'tsuki-webkit'
    fn parse_import(&mut self) -> Result<ImportDecl, WebkitError> {
        self.eat(&Token::Import)?;
        let mut names = Vec::new();

        if self.peek() == &Token::LBrace {
            self.advance();
            while self.peek() != &Token::RBrace && self.peek() != &Token::Eof {
                if let Token::Ident(n) = self.advance() { names.push(n); }
                if self.peek() == &Token::Comma { self.advance(); }
            }
            self.eat(&Token::RBrace)?;
        } else if let Token::Ident(n) = self.peek().clone() {
            names.push(n);
            self.advance();
        }

        self.eat(&Token::From)?;
        let source = match self.advance() {
            Token::Str(s) => s,
            _ => return Err(WebkitError::ParseError { msg: "expected module path string".into(), line: self.line() }),
        };
        // skip optional semicolon
        if self.peek() == &Token::Semicolon { self.advance(); }

        Ok(ImportDecl { names, source })
    }

    // ── JSX element ──────────────────────────────────────────────────────────
    // <Tag attr="v" onClick={handler}>children</Tag>
    fn parse_jsx_element(&mut self) -> Result<JsxNode, WebkitError> {
        self.eat(&Token::TagOpen)?;

        let tag = self.eat_ident()?;
        let attrs = self.parse_jsx_attrs()?;

        // Self-closing?
        if self.peek() == &Token::TagSelfClose {
            self.advance();
            return Ok(JsxNode::Element { tag, attrs, children: vec![] });
        }

        self.eat(&Token::TagClose)?;

        let children = self.parse_jsx_children(&tag)?;

        Ok(JsxNode::Element { tag, attrs, children })
    }

    fn parse_jsx_attrs(&mut self) -> Result<Vec<JsxAttr>, WebkitError> {
        let mut attrs = Vec::new();
        loop {
            match self.peek().clone() {
                Token::Ident(name) => {
                    self.advance();
                    let value = if self.peek() == &Token::Equals {
                        self.advance();
                        match self.peek().clone() {
                            Token::Str(s) => { self.advance(); Some(AttrValue::Str(s)) }
                            Token::LBrace => {
                                self.advance();
                                let expr = self.collect_until_rbrace();
                                Some(AttrValue::Expr(expr))
                            }
                            _ => None,
                        }
                    } else { None };
                    attrs.push(JsxAttr { name, value });
                }
                Token::TagSelfClose | Token::TagClose | Token::Eof => break,
                _ => { self.advance(); } // skip unknown tokens in attr position
            }
        }
        Ok(attrs)
    }

    fn parse_jsx_children(&mut self, parent_tag: &str) -> Result<Vec<JsxNode>, WebkitError> {
        let mut children = Vec::new();
        loop {
            match self.peek().clone() {
                Token::TagClosingSlash => {
                    self.advance();
                    // consume closing tag name
                    if let Token::Ident(_) = self.peek().clone() { self.advance(); }
                    // consume >
                    if self.peek() == &Token::TagClose { self.advance(); }
                    break;
                }
                Token::TagOpen => {
                    let child = self.parse_jsx_element()?;
                    children.push(child);
                }
                Token::LBrace => {
                    self.advance();
                    let expr = self.collect_until_rbrace();
                    children.push(JsxNode::Expr(expr));
                }
                Token::Eof => break,
                Token::Text(t) => {
                    let text = t.clone();
                    self.advance();
                    if !text.trim().is_empty() { children.push(JsxNode::Text(text)); }
                }
                _ => {
                    // collect raw text
                    let tok = self.advance();
                    let raw = format!("{tok:?}");
                    // ignore structural tokens, collect readable text
                    match tok {
                        Token::Ident(s) | Token::Str(s) | Token::Number(s) => {
                            children.push(JsxNode::Text(s));
                        }
                        _ => {}
                    }
                }
            }
        }
        Ok(children)
    }

    // Collect everything up to the matching RBrace (handles nesting)
    fn collect_until_rbrace(&mut self) -> String {
        let mut depth = 1usize;
        let mut out   = String::new();
        while self.peek() != &Token::Eof {
            match self.advance() {
                Token::LBrace          => { depth += 1; out.push('{'); }
                Token::RBrace if depth == 1 => { depth -= 1; break; }
                Token::RBrace          => { depth -= 1; out.push('}'); }
                Token::Ident(s)        => out.push_str(&s),
                Token::Str(s)          => { out.push('"'); out.push_str(&s); out.push('"'); }
                Token::Number(n)       => out.push_str(&n),
                Token::Arrow           => out.push_str(" => "),
                Token::Dot             => out.push('.'),
                Token::LParen          => out.push('('),
                Token::RParen          => out.push(')'),
                Token::Comma           => out.push_str(", "),
                Token::Colon           => out.push(':'),
                Token::Equals         => out.push('='),
                Token::Semicolon       => out.push(';'),
                _                      => out.push(' '),
            }
        }
        out
    }

    // ── Top-level module parse ───────────────────────────────────────────────
    fn parse_module(&mut self) -> Result<Module, WebkitError> {
        let mut module = Module { imports: vec![], jsx_root: None, js_stmts: vec![] };

        while self.peek() != &Token::Eof {
            match self.peek().clone() {
                Token::Import => {
                    module.imports.push(self.parse_import()?);
                }
                Token::Export => {
                    self.advance();
                    // skip `default`
                    if self.peek() == &Token::Default { self.advance(); }
                    // skip function / ident (component name)
                    if self.peek() == &Token::Function { self.advance(); }
                    if let Token::Ident(_) = self.peek() { self.advance(); }
                    // skip ()
                    if self.peek() == &Token::LParen { self.advance(); }
                    if self.peek() == &Token::RParen { self.advance(); }
                    // skip to opening { of function body
                    while self.peek() != &Token::LBrace && self.peek() != &Token::Eof {
                        self.advance();
                    }
                    if self.peek() == &Token::LBrace { self.advance(); }
                    // Scan function body for `return (` and grab JSX
                    self.scan_for_jsx(&mut module)?;
                }
                Token::Newline | Token::Whitespace | Token::Comment(_) => { self.advance(); }
                _ => { self.advance(); }
            }
        }

        Ok(module)
    }

    fn scan_for_jsx(&mut self, module: &mut Module) -> Result<(), WebkitError> {
        while self.peek() != &Token::Eof {
            match self.peek().clone() {
                Token::Return => {
                    self.advance();
                    // skip optional (
                    if self.peek() == &Token::LParen { self.advance(); }
                    // Parse JSX root element
                    if self.peek() == &Token::TagOpen {
                        module.jsx_root = Some(self.parse_jsx_element()?);
                    }
                    return Ok(());
                }
                Token::Const | Token::Let | Token::Var => {
                    // capture JS statement as raw string
                    let stmt = self.collect_js_stmt();
                    module.js_stmts.push(stmt);
                }
                _ => { self.advance(); }
            }
        }
        Ok(())
    }

    fn collect_js_stmt(&mut self) -> String {
        let mut out   = String::new();
        let mut depth = 0i32;
        loop {
            match self.peek().clone() {
                Token::Eof => break,
                Token::Semicolon if depth == 0 => { self.advance(); break; }
                Token::LBrace => { depth += 1; out.push('{'); self.advance(); }
                Token::RBrace if depth > 0 => { depth -= 1; out.push('}'); self.advance(); }
                Token::RBrace => break,
                Token::Ident(s) => { out.push_str(&s); out.push(' '); self.advance(); }
                Token::Str(s)   => { out.push('"'); out.push_str(&s); out.push('"'); self.advance(); }
                Token::Equals   => { out.push_str(" = "); self.advance(); }
                Token::Arrow    => { out.push_str(" => "); self.advance(); }
                _               => { self.advance(); }
            }
        }
        out
    }
}

// ── Public entry-point ────────────────────────────────────────────────────────

pub fn parse(tokens: Vec<Tok>) -> Result<Module, WebkitError> {
    let mut p = Parser::new(tokens);
    p.parse_module()
}
