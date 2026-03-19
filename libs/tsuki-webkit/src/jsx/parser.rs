// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit :: jsx :: parser
//  Parses the token stream into a JsxComponent.
//  Strategy: scan for imports, then find `export default function` and
//  extract the JSX return value + Api.* calls from the function body.
// ─────────────────────────────────────────────────────────────────────────────

use super::ast::*;
use super::lexer::{Token, Tok};
use crate::error::{Result, WebkitError};

pub struct Parser {
    tokens: Vec<Token>,
    pos:    usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    // ── Token helpers ─────────────────────────────────────────────────────────

    fn peek(&self) -> &Tok { &self.tokens.get(self.pos).map(|t| &t.kind).unwrap_or(&Tok::Eof) }
    fn peek_tok(&self) -> &Token { self.tokens.get(self.pos).unwrap_or(self.tokens.last().unwrap()) }
    fn advance(&mut self) -> &Token {
        let t = &self.tokens[self.pos.min(self.tokens.len() - 1)];
        if self.pos < self.tokens.len() - 1 { self.pos += 1; }
        t
    }
    fn eat(&mut self, expected: &Tok) -> Result<()> {
        if self.peek() == expected {
            self.advance();
            Ok(())
        } else {
            let t = self.peek_tok();
            Err(WebkitError::parse(format!("Expected {:?}, got {:?}", expected, self.peek()), t.line, t.col))
        }
    }
    fn at_eof(&self) -> bool { matches!(self.peek(), Tok::Eof) }

    // ── Public entry ──────────────────────────────────────────────────────────

    pub fn parse(mut self) -> Result<JsxComponent> {
        let mut imports    = Vec::new();
        let mut api_routes = Vec::new();
        let mut client_js  = String::new();
        let mut comp_name  = "App".to_string();
        let mut root       = JsxNode::Fragment(vec![]);

        while !self.at_eof() {
            match self.peek() {
                Tok::Import => {
                    if let Some(imp) = self.parse_import()? {
                        imports.push(imp);
                    }
                }
                Tok::Export => {
                    // export default function name() { ... }
                    self.advance(); // eat export
                    if matches!(self.peek(), Tok::Default) {
                        self.advance(); // eat default
                    }
                    if matches!(self.peek(), Tok::Function) {
                        self.advance(); // eat function
                        if let Tok::Ident(name) = self.peek().clone() {
                            comp_name = name;
                            self.advance();
                        }
                        // eat (...)
                        self.skip_parens()?;
                        // parse body
                        let (routes, js, jsx) = self.parse_component_body()?;
                        api_routes = routes;
                        client_js  = js;
                        root       = jsx;
                    } else {
                        self.skip_until_newline();
                    }
                }
                // Top-level Api.get / Api.post outside of export function
                Tok::Ident(id) if id == "Api" => {
                    if let Some(route) = self.try_parse_api_call()? {
                        api_routes.push(route);
                    }
                }
                _ => { self.advance(); }
            }
        }

        Ok(JsxComponent { name: comp_name, imports, api_routes, client_js, root })
    }

    // ── Import parsing ────────────────────────────────────────────────────────

    fn parse_import(&mut self) -> Result<Option<WebkitImport>> {
        self.advance(); // eat import

        // import { A, B } from '...'  OR  import X from '...'
        let mut names = Vec::new();

        if matches!(self.peek(), Tok::LBrace) {
            self.advance(); // {
            loop {
                if let Tok::Ident(n) = self.peek().clone() {
                    names.push(n);
                    self.advance();
                }
                if matches!(self.peek(), Tok::Comma) { self.advance(); continue; }
                if matches!(self.peek(), Tok::RBrace) { self.advance(); break; }
                if self.at_eof() { break; }
                self.advance();
            }
        } else if let Tok::Ident(n) = self.peek().clone() {
            names.push(n);
            self.advance();
        }

        // eat `from`
        if matches!(self.peek(), Tok::From) { self.advance(); }

        let from = if let Tok::Str(s) = self.peek().clone() {
            self.advance();
            s
        } else {
            self.skip_until_newline();
            return Ok(None);
        };

        Ok(Some(WebkitImport { names, from }))
    }

    // ── Component body: { ... return (...) } ─────────────────────────────────

    fn parse_component_body(&mut self) -> Result<(Vec<ApiRoute>, String, JsxNode)> {
        self.eat(&Tok::LBrace)?;

        let mut routes    = Vec::new();
        let mut client_js = String::new();
        let mut root      = JsxNode::Fragment(vec![]);

        while !self.at_eof() {
            if matches!(self.peek(), Tok::RBrace) {
                self.advance();
                break;
            }
            if matches!(self.peek(), Tok::Return) {
                self.advance(); // eat return
                // Skip optional (
                let has_paren = matches!(self.peek(), Tok::LParen);
                if has_paren { self.advance(); }
                root = self.parse_jsx_node()?;
                if has_paren {
                    // consume until matching )
                    while !self.at_eof() && !matches!(self.peek(), Tok::RParen) { self.advance(); }
                    if matches!(self.peek(), Tok::RParen) { self.advance(); }
                }
                continue;
            }
            // Api.get / Api.post calls inside body
            if let Tok::Ident(id) = self.peek().clone() {
                if id == "Api" {
                    if let Some(route) = self.try_parse_api_call()? {
                        routes.push(route);
                        continue;
                    }
                }
                // Collect any other JS as client_js (for browser)
                client_js.push_str(&id);
                client_js.push(' ');
            }
            self.advance();
        }

        Ok((routes, client_js, root))
    }

    // ── JSX node parsing ──────────────────────────────────────────────────────

    fn parse_jsx_node(&mut self) -> Result<JsxNode> {
        match self.peek().clone() {
            // JSX element: <tag ...>
            Tok::Lt => {
                self.advance(); // eat <

                // Fragment: <>
                if matches!(self.peek(), Tok::Gt) {
                    self.advance(); // eat >
                    let children = self.parse_jsx_children(None)?;
                    // eat </>
                    if matches!(self.peek(), Tok::LtSlash) { self.advance(); }
                    if matches!(self.peek(), Tok::Gt) { self.advance(); }
                    return Ok(JsxNode::Fragment(children));
                }

                let tag = if let Tok::Ident(t) = self.peek().clone() {
                    self.advance(); t
                } else {
                    return Ok(JsxNode::Text(String::new()));
                };

                let attrs = self.parse_jsx_attrs()?;

                // Self-closing: />
                if matches!(self.peek(), Tok::SlashGt) {
                    self.advance();
                    return Ok(JsxNode::SelfClosing { tag, attrs });
                }

                // Closing: >  then children  then </tag>
                if matches!(self.peek(), Tok::Gt) {
                    self.advance();
                }

                let children = self.parse_jsx_children(Some(&tag.clone()))?;

                Ok(JsxNode::Element { tag, attrs, children })
            }

            // JSX expression: {expr}
            Tok::LBrace => {
                self.advance();
                let expr = self.collect_until_rbrace();
                Ok(JsxNode::Expr(expr))
            }

            // Text node
            Tok::JsxText(t) => {
                let text = t.clone();
                self.advance();
                Ok(JsxNode::Text(text))
            }

            _ => {
                // Try to collect text
                Ok(JsxNode::Text(String::new()))
            }
        }
    }

    fn parse_jsx_children(&mut self, close_tag: Option<&str>) -> Result<Vec<JsxNode>> {
        let mut children = Vec::new();

        loop {
            if self.at_eof() { break; }

            // End of children: </tag> or </> for fragments
            if matches!(self.peek(), Tok::LtSlash) {
                self.advance(); // eat </
                // eat tag name if present
                if let Tok::Ident(_) = self.peek() { self.advance(); }
                // eat >
                if matches!(self.peek(), Tok::Gt) { self.advance(); }
                break;
            }

            // Closing brace from parent context
            if matches!(self.peek(), Tok::RBrace) { break; }

            let node = self.parse_jsx_node()?;
            // Don't push empty text nodes
            if let JsxNode::Text(ref s) = node {
                if s.trim().is_empty() { continue; }
            }
            children.push(node);
        }

        Ok(children)
    }

    fn parse_jsx_attrs(&mut self) -> Result<Vec<JsxAttr>> {
        let mut attrs = Vec::new();

        loop {
            // Stop on > or />
            if matches!(self.peek(), Tok::Gt | Tok::SlashGt | Tok::Eof) { break; }

            let name = if let Tok::Ident(n) = self.peek().clone() {
                self.advance(); n
            } else {
                self.advance(); continue;
            };

            // Handle hyphenated attr names (data-foo)
            // Already handled in lexer since - is included in Ident

            let value = if matches!(self.peek(), Tok::Eq) {
                self.advance(); // eat =
                match self.peek().clone() {
                    Tok::Str(s) => { self.advance(); JsxAttrValue::Str(s) }
                    Tok::LBrace => {
                        self.advance(); // eat {
                        let expr = self.collect_until_rbrace();
                        JsxAttrValue::Expr(expr)
                    }
                    Tok::Bool(b) => { self.advance(); JsxAttrValue::Str(b.to_string()) }
                    _ => JsxAttrValue::Bool,
                }
            } else {
                JsxAttrValue::Bool
            };

            attrs.push(JsxAttr { name, value });
        }

        Ok(attrs)
    }

    // ── Api route extraction ───────────────────────────────────────────────────
    // Handles: Api.get('/path', () => { ... })
    //      or: Api.get('/path', (req) => { ... })

    fn try_parse_api_call(&mut self) -> Result<Option<ApiRoute>> {
        // We're at Ident("Api")
        self.advance(); // eat Api

        if !matches!(self.peek(), Tok::Dot) { return Ok(None); }
        self.advance(); // eat .

        let method = match self.peek() {
            Tok::Ident(m) => {
                let m = m.clone();
                self.advance();
                match m.as_str() {
                    "get"    => HttpMethod::Get,
                    "post"   => HttpMethod::Post,
                    "put"    => HttpMethod::Put,
                    "delete" => HttpMethod::Delete,
                    _        => return Ok(None),
                }
            }
            _ => return Ok(None),
        };

        // eat (
        if !matches!(self.peek(), Tok::LParen) { return Ok(None); }
        self.advance();

        // path string
        let path = if let Tok::Str(s) = self.peek().clone() {
            self.advance(); s
        } else {
            return Ok(None);
        };

        // eat comma
        if matches!(self.peek(), Tok::Comma) { self.advance(); }

        // handler: () => { ... } or (req) => { ... }
        // skip parameter list
        if matches!(self.peek(), Tok::LParen) { self.skip_parens()?; }
        // eat =>
        if matches!(self.peek(), Tok::Arrow) { self.advance(); }

        // collect body { ... }
        let body = if matches!(self.peek(), Tok::LBrace) {
            self.collect_block()
        } else {
            self.collect_until_paren_close()
        };

        // eat closing )
        if matches!(self.peek(), Tok::RParen) { self.advance(); }

        Ok(Some(ApiRoute { method, path, body }))
    }

    // ── Utility collectors ────────────────────────────────────────────────────

    fn collect_until_rbrace(&mut self) -> String {
        let mut s = String::new();
        let mut depth = 1usize;
        while !self.at_eof() {
            match self.peek() {
                Tok::LBrace => { depth += 1; s.push('{'); self.advance(); }
                Tok::RBrace => {
                    depth -= 1;
                    if depth == 0 { self.advance(); break; }
                    s.push('}'); self.advance();
                }
                Tok::Ident(id) => { s.push_str(id); s.push(' '); self.advance(); }
                Tok::Str(st)   => { s.push('"'); s.push_str(st); s.push('"'); self.advance(); }
                Tok::Num(n)    => { s.push_str(n); self.advance(); }
                Tok::Dot       => { s.push('.'); self.advance(); }
                Tok::LParen    => { s.push('('); self.advance(); }
                Tok::RParen    => { s.push(')'); self.advance(); }
                Tok::Comma     => { s.push(','); s.push(' '); self.advance(); }
                Tok::Plus      => { s.push('+'); self.advance(); }
                Tok::Minus     => { s.push('-'); self.advance(); }
                Tok::Slash     => { s.push('/'); self.advance(); }
                Tok::Colon     => { s.push(':'); self.advance(); }
                _              => { self.advance(); }
            }
        }
        s
    }

    fn collect_block(&mut self) -> String {
        let mut s = String::new();
        let mut depth = 0usize;
        if matches!(self.peek(), Tok::LBrace) { self.advance(); depth = 1; }
        while !self.at_eof() {
            match self.peek() {
                Tok::LBrace => { depth += 1; s.push('{'); self.advance(); }
                Tok::RBrace => {
                    if depth == 0 { break; }
                    depth -= 1;
                    if depth == 0 { self.advance(); break; }
                    s.push('}'); self.advance();
                }
                Tok::Ident(id) => { s.push_str(id); s.push(' '); self.advance(); }
                Tok::Str(st)   => { s.push('"'); s.push_str(st); s.push('"'); self.advance(); }
                Tok::Num(n)    => { s.push_str(n); self.advance(); }
                Tok::Return    => { s.push_str("return "); self.advance(); }
                Tok::Dot       => { s.push('.'); self.advance(); }
                Tok::LParen    => { s.push('('); self.advance(); }
                Tok::RParen    => { s.push(')'); self.advance(); }
                Tok::Comma     => { s.push(", "); self.advance(); }
                Tok::Semi      => { s.push(';'); s.push('\n'); self.advance(); }
                Tok::Plus      => { s.push('+'); self.advance(); }
                Tok::Minus     => { s.push('-'); self.advance(); }
                Tok::Slash     => { s.push('/'); self.advance(); }
                Tok::Colon     => { s.push(':'); self.advance(); }
                _              => { self.advance(); }
            }
        }
        s
    }

    fn collect_until_paren_close(&mut self) -> String {
        let mut s = String::new();
        while !self.at_eof() && !matches!(self.peek(), Tok::RParen) {
            self.advance();
        }
        s
    }

    fn skip_parens(&mut self) -> Result<()> {
        if !matches!(self.peek(), Tok::LParen) { return Ok(()); }
        self.advance();
        let mut depth = 1usize;
        while !self.at_eof() {
            match self.peek() {
                Tok::LParen => { depth += 1; self.advance(); }
                Tok::RParen => {
                    depth -= 1; self.advance();
                    if depth == 0 { break; }
                }
                _ => { self.advance(); }
            }
        }
        Ok(())
    }

    fn skip_until_newline(&mut self) {
        while !self.at_eof() && !matches!(self.peek(), Tok::Semi | Tok::Eof) {
            self.advance();
        }
        if matches!(self.peek(), Tok::Semi) { self.advance(); }
    }
}