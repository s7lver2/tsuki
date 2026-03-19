// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit :: jsx :: lexer
//  Tokenizes a JSX/JS file into a flat token stream.
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::{Result, WebkitError};

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    // ── Keywords ──────────────────────────────────────────────────────────────
    Import, Export, Default, From, Function, Return, Const, Let, Var,
    Arrow,          // =>

    // ── Punctuation ───────────────────────────────────────────────────────────
    LBrace, RBrace, LParen, RParen, LBracket, RBracket,
    Semi, Comma, Dot, Colon, Eq, Plus, Minus, Star, Slash, Bang, And, Or,
    Lt, Gt,          // < >   (also used for JSX open/close)
    SlashGt,         // />
    LtSlash,         // </

    // ── Literals ──────────────────────────────────────────────────────────────
    Ident(String),
    Str(String),     // "..." or '...' or `...`
    Num(String),
    Bool(bool),
    Null,

    // ── JSX-specific ──────────────────────────────────────────────────────────
    /// Raw text between JSX tags (non-empty, trimmed).
    JsxText(String),

    // ── Special ───────────────────────────────────────────────────────────────
    Eof,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: Tok,
    pub line: usize,
    pub col:  usize,
}

// ─────────────────────────────────────────────────────────────────────────────

pub struct Lexer<'a> {
    src:  &'a [char],
    pos:  usize,
    line: usize,
    col:  usize,
    /// When true, we're inside JSX content (between > and <) and should emit
    /// JsxText tokens for raw text rather than identifiers.
    jsx_depth: usize,
}

impl<'a> Lexer<'a> {
    pub fn new(chars: &'a [char]) -> Self {
        Self { src: chars, pos: 0, line: 1, col: 1, jsx_depth: 0 }
    }

    pub fn tokenize(mut self) -> Result<Vec<Token>> {
        let mut tokens = Vec::new();
        loop {
            let tok = self.next_token()?;
            let is_eof = tok.kind == Tok::Eof;
            tokens.push(tok);
            if is_eof { break; }
        }
        Ok(tokens)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn peek(&self) -> Option<char> { self.src.get(self.pos).copied() }
    fn peek2(&self) -> Option<char> { self.src.get(self.pos + 1).copied() }

    fn advance(&mut self) -> Option<char> {
        let c = self.src.get(self.pos).copied()?;
        self.pos += 1;
        if c == '\n' { self.line += 1; self.col = 1; } else { self.col += 1; }
        Some(c)
    }

    fn eat_while(&mut self, f: impl Fn(char) -> bool) -> String {
        let mut s = String::new();
        while let Some(c) = self.peek() {
            if f(c) { self.advance(); s.push(c); } else { break; }
        }
        s
    }

    fn skip_whitespace(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_whitespace() { self.advance(); } else { break; }
        }
    }

    fn skip_line_comment(&mut self) {
        while let Some(c) = self.peek() {
            self.advance();
            if c == '\n' { break; }
        }
    }

    fn skip_block_comment(&mut self) -> Result<()> {
        loop {
            match self.advance() {
                None    => return Err(WebkitError::parse("Unterminated block comment", self.line, self.col)),
                Some('*') if self.peek() == Some('/') => { self.advance(); return Ok(()); }
                _ => {}
            }
        }
    }

    fn read_string(&mut self, delim: char) -> Result<String> {
        let mut s = String::new();
        loop {
            match self.advance() {
                None    => return Err(WebkitError::parse("Unterminated string", self.line, self.col)),
                Some('\\') => {
                    match self.advance() {
                        Some('n') => s.push('\n'),
                        Some('t') => s.push('\t'),
                        Some('r') => s.push('\r'),
                        Some(c)   => s.push(c),
                        None      => return Err(WebkitError::parse("Unterminated escape", self.line, self.col)),
                    }
                }
                Some(c) if c == delim => break,
                Some(c) => s.push(c),
            }
        }
        Ok(s)
    }

    fn read_template_literal(&mut self) -> Result<String> {
        // simplified: no ${} interpolation handling — just read until closing `
        let mut s = String::new();
        loop {
            match self.advance() {
                None    => return Err(WebkitError::parse("Unterminated template literal", self.line, self.col)),
                Some('`') => break,
                Some('\\') => { self.advance(); }
                Some(c)    => s.push(c),
            }
        }
        Ok(s)
    }

    fn read_jsx_text(&mut self) -> String {
        let mut s = String::new();
        while let Some(c) = self.peek() {
            if c == '<' || c == '{' { break; }
            self.advance();
            s.push(c);
        }
        s
    }

    fn make(&self, kind: Tok, line: usize, col: usize) -> Token {
        Token { kind, line, col }
    }

    // ── Main tokenizer ────────────────────────────────────────────────────────

    fn next_token(&mut self) -> Result<Token> {
        // Inside JSX content depth, emit text first before anything else
        if self.jsx_depth > 0 {
            if let Some(c) = self.peek() {
                if c != '<' && c != '{' && c != '\0' {
                    let (line, col) = (self.line, self.col);
                    let text = self.read_jsx_text();
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        return Ok(self.make(Tok::JsxText(trimmed), line, col));
                    }
                    // If only whitespace, fall through
                }
            }
        }

        self.skip_whitespace();

        let (line, col) = (self.line, self.col);

        let c = match self.advance() {
            None    => return Ok(self.make(Tok::Eof, line, col)),
            Some(c) => c,
        };

        // Comments
        if c == '/' {
            match self.peek() {
                Some('/') => { self.advance(); self.skip_line_comment(); return self.next_token(); }
                Some('*') => { self.advance(); self.skip_block_comment()?; return self.next_token(); }
                Some('>') => { self.advance(); self.jsx_depth = self.jsx_depth.saturating_sub(1); return Ok(self.make(Tok::SlashGt, line, col)); }
                _ => return Ok(self.make(Tok::Slash, line, col)),
            }
        }

        let tok = match c {
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '[' => Tok::LBracket,
            ']' => Tok::RBracket,
            ';' => Tok::Semi,
            ',' => Tok::Comma,
            '.' => Tok::Dot,
            ':' => Tok::Colon,
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '!' => Tok::Bang,
            '&' => { if self.peek() == Some('&') { self.advance(); } Tok::And }
            '|' => { if self.peek() == Some('|') { self.advance(); } Tok::Or }
            '=' => {
                if self.peek() == Some('>') { self.advance(); Tok::Arrow }
                else { Tok::Eq }
            }
            '<' => {
                if self.peek() == Some('/') {
                    self.advance();
                    self.jsx_depth = self.jsx_depth.saturating_sub(1);
                    Tok::LtSlash
                } else {
                    Tok::Lt
                }
            }
            '>' => {
                if self.jsx_depth > 0 {
                    // entering JSX content
                }
                Tok::Gt
            }
            '"' | '\'' => {
                let s = self.read_string(c)?;
                Tok::Str(s)
            }
            '`' => {
                let s = self.read_template_literal()?;
                Tok::Str(s)
            }
            c if c.is_ascii_digit() => {
                let mut n = c.to_string();
                n.push_str(&self.eat_while(|ch| ch.is_ascii_digit() || ch == '.' || ch == 'x' || ch == 'X'));
                Tok::Num(n)
            }
            c if c.is_alphabetic() || c == '_' || c == '$' => {
                let mut id = c.to_string();
                id.push_str(&self.eat_while(|ch| ch.is_alphanumeric() || ch == '_' || ch == '$' || ch == '-'));
                match id.as_str() {
                    "import"   => Tok::Import,
                    "export"   => Tok::Export,
                    "default"  => Tok::Default,
                    "from"     => Tok::From,
                    "function" => Tok::Function,
                    "return"   => Tok::Return,
                    "const"    => Tok::Const,
                    "let"      => Tok::Let,
                    "var"      => Tok::Var,
                    "true"     => Tok::Bool(true),
                    "false"    => Tok::Bool(false),
                    "null"     => Tok::Null,
                    _          => Tok::Ident(id),
                }
            }
            _ => return self.next_token(), // skip unknown chars
        };

        // Track JSX depth for < > pairs (heuristic: after Gt with jsx tag context)
        // We adjust jsx_depth when we see <Tag> or </Tag>
        if tok == Tok::Gt && self.jsx_depth == 0 {
            // potentially entering JSX - this is managed by the parser
        }

        Ok(self.make(tok, line, col))
    }
}

/// Lex a JSX/JS source string into tokens.
pub fn lex(src: &str) -> Result<Vec<Token>> {
    let chars: Vec<char> = src.chars().collect();
    Lexer::new(&chars).tokenize()
}