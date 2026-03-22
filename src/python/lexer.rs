// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: python :: lexer
//
//  Tokenises a Python source string into Vec<PyToken>.
//  Handles the indentation-based block structure via INDENT / DEDENT tokens
//  using a column-stack, matching the CPython tokenizer behaviour for the
//  Arduino-Python subset tsuki supports.
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::{Span, TsukiError, Result};

// ── Token kinds ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum PyTokenKind {
    // ── Literals ──────────────────────────────────────────────────────────────
    Int(i64),
    Float(f64),
    Str(String),
    Bool(bool),
    None,

    // ── Identifiers ───────────────────────────────────────────────────────────
    Ident(String),

    // ── Keywords ──────────────────────────────────────────────────────────────
    Def,
    Return,
    If,
    Elif,
    Else,
    While,
    For,
    In,
    Import,
    From,
    Pass,
    Break,
    Continue,
    Class,
    And,
    Or,
    Not,
    Global,

    // ── Operators ─────────────────────────────────────────────────────────────
    Plus,       // +
    Minus,      // -
    Star,       // *
    Slash,      // /
    SlashSlash, // //
    Percent,    // %
    StarStar,   // **
    Eq,         // ==
    NotEq,      // !=
    Lt,         // <
    Gt,         // >
    LtEq,       // <=
    GtEq,       // >=
    Assign,     // =
    PlusEq,     // +=
    MinusEq,    // -=
    StarEq,     // *=
    SlashEq,    // /=
    Amp,        // &
    Pipe,       // |
    Caret,      // ^
    Tilde,      // ~
    LShift,     // <<
    RShift,     // >>

    // ── Delimiters ────────────────────────────────────────────────────────────
    LParen,  // (
    RParen,  // )
    LBrack,  // [
    RBrack,  // ]
    LBrace,  // {
    RBrace,  // }
    Comma,   // ,
    Dot,     // .
    Colon,   // :
    Arrow,   // ->
    At,      // @ (decorator, also used for matrix mult — ignored in tsuki)

    // ── Structural ────────────────────────────────────────────────────────────
    Newline,
    Indent,
    Dedent,
    Comment(String),
    Eof,
}

#[derive(Debug, Clone)]
pub struct PyToken {
    pub kind: PyTokenKind,
    pub span: Span,
}

impl PyToken {
    fn new(kind: PyTokenKind, span: Span) -> Self {
        Self { kind, span }
    }
}

// ── Lexer ─────────────────────────────────────────────────────────────────────

/// Optimised Python lexer — iterates the source as bytes/chars directly
/// instead of collecting into Vec<char> first.
pub struct PyLexer<'src> {
    src:          &'src str,    // original source — indexed directly
    pos:          usize,        // byte offset
    line:         u32,
    col:          u32,
    filename:     std::sync::Arc<str>,
    indent_stack: Vec<usize>,
    pending:      Vec<PyToken>,
    at_line_start: bool,
}

impl<'src> PyLexer<'src> {
    pub fn new(src: &'src str, filename: &str) -> Self {
        Self {
            src,
            pos:          0,
            line:         1,
            col:          1,
            filename:     filename.into(),
            indent_stack: vec![0],
            pending:      Vec::with_capacity(4),
            at_line_start: true,
        }
    }

    // ── Public entry ──────────────────────────────────────────────────────────

    pub fn tokenize(mut self) -> Result<Vec<PyToken>> {
        let capacity = (self.src.len() / 5).max(32);
        let mut tokens = Vec::with_capacity(capacity);
        loop {
            let tok = self.next_token()?;
            let is_eof = tok.kind == PyTokenKind::Eof;
            tokens.push(tok);
            if is_eof { break; }
        }
        Ok(tokens)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn span(&self) -> Span {
        Span::new_arc(self.filename.clone(), self.line, self.col, self.pos)
    }

    #[inline]
    fn peek(&self) -> Option<char> {
        self.src[self.pos..].chars().next()
    }

    #[inline]
    fn peek2(&self) -> Option<char> {
        let mut it = self.src[self.pos..].chars();
        it.next();
        it.next()
    }

    #[inline]
    fn advance(&mut self) -> Option<char> {
        let c = self.src[self.pos..].chars().next()?;
        self.pos += c.len_utf8();
        if c == '\n' { self.line += 1; self.col = 1; }
        else           { self.col += 1; }
        Some(c)
    }

    fn eat(&mut self, expected: char) -> bool {
        if self.peek() == Some(expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn lex_error(&self, msg: impl Into<String>) -> TsukiError {
        TsukiError::Lex { msg: msg.into(), span: self.span() }
    }

    // ── Indentation handling ──────────────────────────────────────────────────

    /// Measure indentation of the current line (called when `at_line_start`).
    /// Consumes leading spaces/tabs and returns column count (tabs = 8 spaces).
    fn measure_indent(&mut self) -> usize {
        let mut col = 0usize;
        loop {
            match self.src.as_bytes().get(self.pos).copied() {
                Some(b' ')  => { self.pos += 1; self.col += 1; col += 1; }
                Some(b'\t') => { self.pos += 1; self.col += 1; col = (col / 8 + 1) * 8; }
                _ => break,
            }
        }
        col
    }

    // ── Main scan loop ────────────────────────────────────────────────────────

    fn next_token(&mut self) -> Result<PyToken> {
        // Drain pending queue first (e.g. multiple DEDENTs)
        if let Some(tok) = self.pending.pop() {
            return Ok(tok);
        }

        // Handle indentation at the start of a logical line
        if self.at_line_start {
            self.at_line_start = false;
            let sp = self.span();
            let indent = self.measure_indent();

            // Skip blank lines and comment-only lines
            loop {
                match self.peek() {
                    Some('\n') => {
                        self.advance();
                        // blank line — restart indentation check
                        let sp2 = self.span();
                        let ind2 = self.measure_indent();
                        // if still blank, continue
                        match self.peek() {
                            Some('\n') | Some('#') => {
                                // will loop again
                                if self.peek() == Some('#') {
                                    self.skip_comment();
                                }
                                continue;
                            }
                            None => {
                                // end of file on a blank line
                                return self.emit_eof(sp2);
                            }
                            _ => {
                                return self.handle_indent(ind2, sp2);
                            }
                        }
                    }
                    Some('#') => {
                        let comment = self.lex_comment();
                        // skip comment on blank line — still at line start
                        self.at_line_start = true;
                        return Ok(PyToken::new(PyTokenKind::Comment(comment), sp));
                    }
                    None => return self.emit_eof(sp),
                    _ => break,
                }
            }

            return self.handle_indent(indent, sp);
        }

        // Skip inline whitespace (spaces/tabs between tokens on the same line)
        loop {
            match self.peek() {
                Some(' ') | Some('\t') => { self.advance(); }
                _ => break,
            }
        }

        let sp = self.span();

        match self.peek() {
            None => self.emit_eof(sp),

            Some('\n') => {
                self.advance();
                self.at_line_start = true;
                Ok(PyToken::new(PyTokenKind::Newline, sp))
            }

            Some('\\') => {
                // Explicit line continuation — consume backslash + newline
                self.advance();
                if self.peek() == Some('\n') { self.advance(); }
                self.next_token()
            }

            Some('#') => {
                let comment = self.lex_comment();
                Ok(PyToken::new(PyTokenKind::Comment(comment), sp))
            }

            Some('"') | Some('\'') => {
                let s = self.lex_string()?;
                Ok(PyToken::new(PyTokenKind::Str(s), sp))
            }

            Some(c) if c.is_ascii_digit() => {
                let t = self.lex_number(sp.clone())?;
                Ok(t)
            }

            Some(c) if c.is_alphabetic() || c == '_' => {
                let ident = self.lex_ident();
                let kind = Self::classify_ident(&ident);
                Ok(PyToken::new(kind, sp))
            }

            Some(c) => self.lex_symbol(c, sp),
        }
    }

    fn handle_indent(&mut self, indent: usize, sp: Span) -> Result<PyToken> {
        let current = *self.indent_stack.last().unwrap();
        if indent > current {
            self.indent_stack.push(indent);
            Ok(PyToken::new(PyTokenKind::Indent, sp))
        } else if indent < current {
            // Pop indent levels, queue DEDENTs
            while *self.indent_stack.last().unwrap() > indent {
                self.indent_stack.pop();
                if *self.indent_stack.last().unwrap() < indent {
                    return Err(TsukiError::Lex {
                        msg: "indentation error: unindent does not match any outer level".into(),
                        span: sp,
                    });
                }
                self.pending.push(PyToken::new(PyTokenKind::Dedent, sp.clone()));
            }
            // Return first DEDENT (rest are in pending)
            Ok(self.pending.pop().unwrap())
        } else {
            // Same level — just scan normally
            self.next_token()
        }
    }

    fn emit_eof(&mut self, sp: Span) -> Result<PyToken> {
        // Emit any remaining DEDENTs before EOF
        if self.indent_stack.len() > 1 {
            self.indent_stack.pop();
            self.pending.push(PyToken::new(PyTokenKind::Eof, sp.clone()));
            Ok(PyToken::new(PyTokenKind::Dedent, sp))
        } else {
            Ok(PyToken::new(PyTokenKind::Eof, sp))
        }
    }

    fn skip_comment(&mut self) {
        while self.pos < self.src.len() && self.src.as_bytes()[self.pos] != b'\n' {
            self.pos += 1;
        }
    }

    fn lex_comment(&mut self) -> String {
        self.advance(); // consume '#'
        let start = self.pos;
        // Fast byte scan — comments are ASCII
        while self.pos < self.src.len() && self.src.as_bytes()[self.pos] != b'\n' {
            self.pos += 1;
        }
        self.src[start..self.pos].trim().to_owned()
    }

    fn lex_ident(&mut self) -> String {
        let start = self.pos;
        while self.pos < self.src.len() {
            let c = self.src[self.pos..].chars().next().unwrap();
            if c.is_alphanumeric() || c == '_' {
                self.pos += c.len_utf8();
                self.col += 1;
            } else {
                break;
            }
        }
        self.src[start..self.pos].to_owned()
    }

    fn classify_ident(s: &str) -> PyTokenKind {
        match s {
            "def"      => PyTokenKind::Def,
            "return"   => PyTokenKind::Return,
            "if"       => PyTokenKind::If,
            "elif"     => PyTokenKind::Elif,
            "else"     => PyTokenKind::Else,
            "while"    => PyTokenKind::While,
            "for"      => PyTokenKind::For,
            "in"       => PyTokenKind::In,
            "import"   => PyTokenKind::Import,
            "from"     => PyTokenKind::From,
            "pass"     => PyTokenKind::Pass,
            "break"    => PyTokenKind::Break,
            "continue" => PyTokenKind::Continue,
            "class"    => PyTokenKind::Class,
            "and"      => PyTokenKind::And,
            "or"       => PyTokenKind::Or,
            "not"      => PyTokenKind::Not,
            "global"   => PyTokenKind::Global,
            "True"     => PyTokenKind::Bool(true),
            "False"    => PyTokenKind::Bool(false),
            "None"     => PyTokenKind::None,
            _          => PyTokenKind::Ident(s.to_owned()),
        }
    }

    fn lex_number(&mut self, sp: Span) -> Result<PyToken> {
        let mut s = String::new();
        let mut is_float = false;

        // Hex / binary / octal prefix
        if self.peek() == Some('0') {
            s.push(self.advance().unwrap());
            match self.peek() {
                Some('x') | Some('X') => {
                    s.push(self.advance().unwrap());
                    while let Some(c) = self.peek() {
                        if c.is_ascii_hexdigit() || c == '_' { s.push(self.advance().unwrap()); }
                        else { break; }
                    }
                    let cleaned = s.replace('_', "");
                    let v = i64::from_str_radix(&cleaned[2..], 16)
                        .map_err(|_| self.lex_error(format!("invalid hex literal: {}", s)))?;
                    return Ok(PyToken::new(PyTokenKind::Int(v), sp));
                }
                Some('b') | Some('B') => {
                    s.push(self.advance().unwrap());
                    while let Some(c) = self.peek() {
                        if c == '0' || c == '1' || c == '_' { s.push(self.advance().unwrap()); }
                        else { break; }
                    }
                    let cleaned = s.replace('_', "");
                    let v = i64::from_str_radix(&cleaned[2..], 2)
                        .map_err(|_| self.lex_error(format!("invalid binary literal: {}", s)))?;
                    return Ok(PyToken::new(PyTokenKind::Int(v), sp));
                }
                Some('o') | Some('O') => {
                    s.push(self.advance().unwrap());
                    while let Some(c) = self.peek() {
                        if ('0'..='7').contains(&c) || c == '_' { s.push(self.advance().unwrap()); }
                        else { break; }
                    }
                    let cleaned = s.replace('_', "");
                    let v = i64::from_str_radix(&cleaned[2..], 8)
                        .map_err(|_| self.lex_error(format!("invalid octal literal: {}", s)))?;
                    return Ok(PyToken::new(PyTokenKind::Int(v), sp));
                }
                _ => {}
            }
        }

        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == '_' { s.push(self.advance().unwrap()); }
            else { break; }
        }
        if self.peek() == Some('.') && self.peek2().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            is_float = true;
            s.push(self.advance().unwrap());
            while let Some(c) = self.peek() {
                if c.is_ascii_digit() || c == '_' { s.push(self.advance().unwrap()); }
                else { break; }
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            is_float = true;
            s.push(self.advance().unwrap());
            if matches!(self.peek(), Some('+') | Some('-')) { s.push(self.advance().unwrap()); }
            while let Some(c) = self.peek() {
                if c.is_ascii_digit() { s.push(self.advance().unwrap()); }
                else { break; }
            }
        }

        let cleaned = s.replace('_', "");
        if is_float {
            let v: f64 = cleaned.parse()
                .map_err(|_| self.lex_error(format!("invalid float: {}", s)))?;
            Ok(PyToken::new(PyTokenKind::Float(v), sp))
        } else {
            let v: i64 = cleaned.parse()
                .map_err(|_| self.lex_error(format!("invalid integer: {}", s)))?;
            Ok(PyToken::new(PyTokenKind::Int(v), sp))
        }
    }

    fn lex_string(&mut self) -> Result<String> {
        let quote = self.advance().unwrap();
        // Triple-quoted strings
        if self.peek() == Some(quote) && self.peek2() == Some(quote) {
            self.advance(); self.advance();
            return self.lex_triple_string(quote);
        }
        let mut s = String::new();
        loop {
            match self.advance() {
                None | Some('\n') => return Err(self.lex_error("unterminated string literal")),
                Some(c) if c == quote => break,
                Some('\\') => {
                    match self.advance() {
                        Some('n')  => s.push('\n'),
                        Some('t')  => s.push('\t'),
                        Some('r')  => s.push('\r'),
                        Some('\\') => s.push('\\'),
                        Some('\'') => s.push('\''),
                        Some('"')  => s.push('"'),
                        Some('0')  => s.push('\0'),
                        Some(c)    => { s.push('\\'); s.push(c); }
                        None       => return Err(self.lex_error("unexpected EOF in string")),
                    }
                }
                Some(c) => s.push(c),
            }
        }
        Ok(s)
    }

    fn lex_triple_string(&mut self, quote: char) -> Result<String> {
        let mut s = String::new();
        loop {
            match self.advance() {
                None => return Err(self.lex_error("unterminated triple-quoted string")),
                Some(c) if c == quote => {
                    if self.peek() == Some(quote) && self.peek2() == Some(quote) {
                        self.advance(); self.advance();
                        break;
                    }
                    s.push(c);
                }
                Some(c) => s.push(c),
            }
        }
        Ok(s)
    }

    fn lex_symbol(&mut self, c: char, sp: Span) -> Result<PyToken> {
        self.advance();
        let kind = match c {
            '(' => PyTokenKind::LParen,
            ')' => PyTokenKind::RParen,
            '[' => PyTokenKind::LBrack,
            ']' => PyTokenKind::RBrack,
            '{' => PyTokenKind::LBrace,
            '}' => PyTokenKind::RBrace,
            ',' => PyTokenKind::Comma,
            '.' => PyTokenKind::Dot,
            ':' => PyTokenKind::Colon,
            '@' => PyTokenKind::At,
            '~' => PyTokenKind::Tilde,
            '^' => if self.eat('=') { PyTokenKind::Assign } else { PyTokenKind::Caret },
            '+' => if self.eat('=') { PyTokenKind::PlusEq  } else { PyTokenKind::Plus  },
            '%' => if self.eat('=') { PyTokenKind::Assign  } else { PyTokenKind::Percent },
            '&' => PyTokenKind::Amp,
            '|' => PyTokenKind::Pipe,
            '-' => {
                if self.eat('>') { PyTokenKind::Arrow }
                else if self.eat('=') { PyTokenKind::MinusEq }
                else { PyTokenKind::Minus }
            }
            '*' => {
                if self.eat('*') { PyTokenKind::StarStar }
                else if self.eat('=') { PyTokenKind::StarEq }
                else { PyTokenKind::Star }
            }
            '/' => {
                if self.eat('/') { PyTokenKind::SlashSlash }
                else if self.eat('=') { PyTokenKind::SlashEq }
                else { PyTokenKind::Slash }
            }
            '=' => {
                if self.eat('=') { PyTokenKind::Eq }
                else { PyTokenKind::Assign }
            }
            '!' => {
                if self.eat('=') { PyTokenKind::NotEq }
                else { return Err(TsukiError::Lex { msg: "expected '=' after '!'".into(), span: sp }); }
            }
            '<' => {
                if self.eat('=') { PyTokenKind::LtEq }
                else if self.eat('<') { PyTokenKind::LShift }
                else { PyTokenKind::Lt }
            }
            '>' => {
                if self.eat('=') { PyTokenKind::GtEq }
                else if self.eat('>') { PyTokenKind::RShift }
                else { PyTokenKind::Gt }
            }
            c => return Err(TsukiError::Lex {
                msg: format!("unexpected character: {:?}", c),
                span: sp,
            }),
        };
        Ok(PyToken::new(kind, sp))
    }
}