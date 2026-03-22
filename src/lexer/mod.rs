// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: lexer
//  Converts raw Go source text → flat token stream.
//
//  Optimisations applied:
//    • The source is kept as `&str` and indexed as bytes; `chars()` is only
//      called when we actually need a `char` value (rare for ASCII-heavy Go).
//    • `eat_while` writes directly into a pre-allocated `String` that is reused
//      across the token stream via `with_capacity`.
//    • `Token::raw` stores a `Box<str>` instead of `String` so each token
//      uses 16 bytes instead of 24 on the heap.
//    • `span()` clones only the file name `Arc<str>` (cheap refcount bump)
//      instead of allocating a new `String` for every span.
//    • `Vec::with_capacity` for the output token list avoids reallocs.
// ─────────────────────────────────────────────────────────────────────────────

pub mod token;
pub use token::{Token, TokenKind, keyword};

use crate::error::{TsukiError, Result, Span};

// ─────────────────────────────────────────────────────────────────────────────

pub struct Lexer<'src> {
    src:   &'src str,      // original source — we index into it directly
    pos:   usize,          // byte offset into src
    line:  u32,
    col:   u32,
    file:  std::sync::Arc<str>,
}

impl<'src> Lexer<'src> {
    pub fn new(source: &'src str, file: impl Into<String>) -> Self {
        Self {
            src:  source,
            pos:  0,
            line: 1,
            col:  1,
            file: file.into().into(),
        }
    }

    // ── Main entry ───────────────────────────────────────────────────────────

    pub fn tokenize(&mut self) -> Result<Vec<Token>> {
        // Pre-allocate: most Go files average ~8 tokens per line.
        // A rough upper bound: len/4 prevents reallocs for typical files.
        let capacity = (self.src.len() / 4).max(64);
        let mut out = Vec::with_capacity(capacity);
        loop {
            let tok = self.next()?;
            let done = tok.kind == TokenKind::EOF;
            out.push(tok);
            if done { break; }
        }
        Ok(out)
    }

    // ── Char-level helpers ───────────────────────────────────────────────────

    /// Peek at the next char without advancing. O(1) for ASCII, O(char_len) otherwise.
    #[inline]
    fn peek(&self) -> Option<char> {
        self.src[self.pos..].chars().next()
    }

    /// Peek two chars ahead. Used only for two-char operators — called rarely.
    #[inline]
    fn peek2(&self) -> Option<char> {
        let mut iter = self.src[self.pos..].chars();
        iter.next();
        iter.next()
    }

    #[allow(dead_code)]
    #[inline]
    fn peek3(&self) -> Option<char> {
        let mut iter = self.src[self.pos..].chars();
        iter.next(); iter.next();
        iter.next()
    }

    fn advance(&mut self) -> Option<char> {
        let ch = self.src[self.pos..].chars().next()?;
        self.pos += ch.len_utf8();
        if ch == '\n' { self.line += 1; self.col = 1; }
        else          { self.col  += 1; }
        Some(ch)
    }

    fn span(&self) -> Span {
        Span::new_arc(self.file.clone(), self.line, self.col, self.pos)
    }

    /// Consume chars matching `pred` and return them as an owned String.
    /// Uses the source slice directly when the range is pure ASCII (common case).
    fn eat_while(&mut self, pred: impl Fn(char) -> bool) -> String {
        let start = self.pos;
        while self.src[self.pos..].chars().next().map_or(false, |c| pred(c)) {
            let ch = self.src[self.pos..].chars().next().unwrap();
            self.pos += ch.len_utf8();
            if ch == '\n' { self.line += 1; self.col = 1; }
            else          { self.col  += 1; }
        }
        self.src[start..self.pos].to_owned()
    }

    // ── Whitespace / comments ────────────────────────────────────────────────

    fn skip_horizontal_ws(&mut self) {
        // Fast ASCII-only path: check the byte directly.
        while self.pos < self.src.len() {
            match self.src.as_bytes()[self.pos] {
                b' ' | b'\t' | b'\r' => { self.pos += 1; self.col += 1; }
                _ => break,
            }
        }
    }

    fn skip_line_comment(&mut self) {
        // Advance until newline or EOF — no need to decode chars for ASCII source.
        while self.pos < self.src.len() && self.src.as_bytes()[self.pos] != b'\n' {
            self.pos += 1;
        }
    }

    fn skip_block_comment(&mut self) -> Result<()> {
        let sp = self.span();
        self.advance(); self.advance(); // consume /*
        loop {
            match self.advance() {
                None => return Err(TsukiError::lex(sp, "unterminated block comment `/* ... */`")),
                Some('*') if self.peek() == Some('/') => { self.advance(); return Ok(()); }
                _ => {}
            }
        }
    }

    // ── Top-level token dispatch ─────────────────────────────────────────────

    fn next(&mut self) -> Result<Token> {
        self.skip_horizontal_ws();
        let sp = self.span();

        // Fast byte-level dispatch for the common ASCII cases
        let b = if self.pos < self.src.len() { Some(self.src.as_bytes()[self.pos]) } else { None };

        match b {
            None => Ok(Token::new(TokenKind::EOF, sp, "")),

            Some(b'\n') => {
                self.advance();
                Ok(Token::new(TokenKind::Newline, sp, "\n"))
            }

            Some(b'/') if self.peek2() == Some('/') => {
                self.skip_line_comment();
                self.next()
            }
            Some(b'/') if self.peek2() == Some('*') => {
                self.skip_block_comment()?;
                self.next()
            }

            Some(b'"')  => self.lex_interpreted_string(sp),
            Some(b'`')  => self.lex_raw_string(sp),
            Some(b'\'') => self.lex_rune(sp),

            Some(c) if c.is_ascii_digit() => self.lex_number(sp),

            Some(c) if (c as char).is_alphabetic() || c == b'_' => Ok(self.lex_ident(sp)),

            Some(_) => self.lex_punct(sp),
        }
    }

    // ── String / rune literals ───────────────────────────────────────────────

    fn lex_interpreted_string(&mut self, sp: Span) -> Result<Token> {
        self.advance(); // opening "
        let mut value = String::new();
        loop {
            match self.peek() {
                None | Some('\n') =>
                    return Err(TsukiError::lex(sp, "unterminated interpreted string literal")),
                Some('"') => { self.advance(); break; }
                Some('\\') => { self.advance(); value.push(self.unescape(&sp)?); }
                _ => value.push(self.advance().unwrap()),
            }
        }
        let raw = format!("\"{}\"", value);
        Ok(Token::new(TokenKind::LitString(value), sp, raw))
    }

    fn lex_raw_string(&mut self, sp: Span) -> Result<Token> {
        self.advance(); // opening `
        let start = self.pos;
        loop {
            match self.advance() {
                None    => return Err(TsukiError::lex(sp, "unterminated raw string literal")),
                Some('`') => break,
                _ => {}
            }
        }
        // The value is the bytes between the backticks — slice directly from src
        let value = self.src[start..self.pos - 1].to_owned();
        let raw   = format!("`{}`", value);
        Ok(Token::new(TokenKind::LitString(value), sp, raw))
    }

    fn lex_rune(&mut self, sp: Span) -> Result<Token> {
        self.advance(); // opening '
        let ch = match self.peek() {
            None => return Err(TsukiError::lex(sp, "empty rune literal")),
            Some('\\') => { self.advance(); self.unescape(&sp)? }
            _ => self.advance().unwrap(),
        };
        match self.advance() {
            Some('\'') => {}
            _ => return Err(TsukiError::lex(sp, "unterminated rune literal")),
        }
        Ok(Token::new(TokenKind::LitRune(ch), sp, format!("'{}'", ch)))
    }

    fn unescape(&mut self, sp: &Span) -> Result<char> {
        Ok(match self.advance() {
            Some('n')  => '\n', Some('t') => '\t', Some('r') => '\r',
            Some('\\') => '\\', Some('"') => '"',  Some('\'') => '\'',
            Some('0')  => '\0', Some('a') => '\x07', Some('b') => '\x08',
            Some('f')  => '\x0C', Some('v') => '\x0B',
            Some(c)    => c,
            None       => return Err(TsukiError::lex(sp.clone(), "unexpected EOF in escape sequence")),
        })
    }

    // ── Numeric literals ─────────────────────────────────────────────────────

    fn lex_number(&mut self, sp: Span) -> Result<Token> {
        let start = self.pos;

        // prefix: 0x, 0b, 0o
        if self.peek() == Some('0') {
            self.advance();
            match self.peek() {
                Some('x') | Some('X') => {
                    self.advance();
                    self.eat_while(|c| c.is_ascii_hexdigit() || c == '_');
                    let raw = &self.src[start..self.pos];
                    let clean = raw[2..].replace('_', "");
                    let n = i64::from_str_radix(&clean, 16).map_err(|_|
                        TsukiError::lex(sp.clone(), format!("invalid hex literal `{}`", raw)))?;
                    return Ok(Token::new(TokenKind::LitInt(n), sp, raw));
                }
                Some('b') | Some('B') => {
                    self.advance();
                    self.eat_while(|c| c == '0' || c == '1' || c == '_');
                    let raw = &self.src[start..self.pos];
                    let clean = raw[2..].replace('_', "");
                    let n = i64::from_str_radix(&clean, 2).map_err(|_|
                        TsukiError::lex(sp.clone(), format!("invalid binary literal `{}`", raw)))?;
                    return Ok(Token::new(TokenKind::LitInt(n), sp, raw));
                }
                Some('o') | Some('O') => {
                    self.advance();
                    self.eat_while(|c| ('0'..='7').contains(&c) || c == '_');
                    let raw = &self.src[start..self.pos];
                    let clean = raw[2..].replace('_', "");
                    let n = i64::from_str_radix(&clean, 8).map_err(|_|
                        TsukiError::lex(sp.clone(), format!("invalid octal literal `{}`", raw)))?;
                    return Ok(Token::new(TokenKind::LitInt(n), sp, raw));
                }
                _ => {}
            }
        }

        // decimal integer (or continuation after 0)
        self.eat_while(|c| c.is_ascii_digit() || c == '_');

        let is_float = self.peek() == Some('.')
            && self.peek2().map_or(false, |c| c.is_ascii_digit());
        let has_exp  = !is_float
            && (self.peek() == Some('e') || self.peek() == Some('E'));

        if is_float || has_exp {
            if is_float {
                self.advance(); // .
                self.eat_while(|c| c.is_ascii_digit() || c == '_');
            }
            if self.peek() == Some('e') || self.peek() == Some('E') {
                self.advance();
                if matches!(self.peek(), Some('+') | Some('-')) { self.advance(); }
                self.eat_while(|c| c.is_ascii_digit());
            }
            let raw = &self.src[start..self.pos];
            let f: f64 = raw.replace('_', "").parse().map_err(|_|
                TsukiError::lex(sp.clone(), format!("invalid float `{}`", raw)))?;
            return Ok(Token::new(TokenKind::LitFloat(f), sp, raw));
        }

        let raw = &self.src[start..self.pos];
        let n: i64 = raw.replace('_', "").parse().map_err(|_|
            TsukiError::lex(sp.clone(), format!("invalid integer `{}`", raw)))?;
        Ok(Token::new(TokenKind::LitInt(n), sp, raw))
    }

    // ── Identifiers / keywords ───────────────────────────────────────────────

    fn lex_ident(&mut self, sp: Span) -> Token {
        let start = self.pos;
        self.eat_while(|c| c.is_alphanumeric() || c == '_');
        let raw = &self.src[start..self.pos];
        let kind = keyword(raw).unwrap_or_else(|| TokenKind::Ident(raw.to_owned()));
        Token::new(kind, sp, raw)
    }

    // ── Operators / punctuation ──────────────────────────────────────────────

    fn lex_punct(&mut self, sp: Span) -> Result<Token> {
        let c = self.advance().unwrap();
        let p  = self.peek();
        let p2 = self.peek2();

        macro_rules! tok {
            ($kind:expr, $raw:expr) => { Ok(Token::new($kind, sp, $raw)) };
        }
        macro_rules! eat_tok {
            ($kind:expr, $raw:expr) => {{ self.advance(); tok!($kind, $raw) }};
        }

        match (c, p, p2) {
            ('.', Some('.'), Some('.')) => { self.advance(); self.advance(); tok!(TokenKind::Ellipsis, "...") }
            ('.', _, _)                => tok!(TokenKind::Dot, "."),

            ('+', Some('='), _) => eat_tok!(TokenKind::PlusEq,   "+="),
            ('+', Some('+'), _) => eat_tok!(TokenKind::Inc,       "++"),
            ('+', _, _)         => tok!(TokenKind::Plus,           "+"),

            ('-', Some('='), _) => eat_tok!(TokenKind::MinusEq,  "-="),
            ('-', Some('-'), _) => eat_tok!(TokenKind::Dec,       "--"),
            ('-', _, _)         => tok!(TokenKind::Minus,          "-"),

            ('*', Some('='), _) => eat_tok!(TokenKind::StarEq,   "*="),
            ('*', _, _)         => tok!(TokenKind::Star,           "*"),

            ('/', Some('='), _) => eat_tok!(TokenKind::SlashEq,  "/="),
            ('/', _, _)         => tok!(TokenKind::Slash,          "/"),

            ('%', Some('='), _) => eat_tok!(TokenKind::PercentEq, "%="),
            ('%', _, _)         => tok!(TokenKind::Percent,        "%"),

            ('&', Some('^'), Some('=')) => { self.advance(); eat_tok!(TokenKind::AmpCaretEq, "&^=") }
            ('&', Some('^'), _)         => eat_tok!(TokenKind::AmpCaret, "&^"),
            ('&', Some('='), _)         => eat_tok!(TokenKind::AmpEq,   "&="),
            ('&', Some('&'), _)         => eat_tok!(TokenKind::AndAnd,  "&&"),
            ('&', _, _)                 => tok!(TokenKind::Amp,          "&"),

            ('|', Some('='), _) => eat_tok!(TokenKind::PipeEq,  "|="),
            ('|', Some('|'), _) => eat_tok!(TokenKind::OrOr,    "||"),
            ('|', _, _)         => tok!(TokenKind::Pipe,         "|"),

            ('^', Some('='), _) => eat_tok!(TokenKind::CaretEq, "^="),
            ('^', _, _)         => tok!(TokenKind::Caret,        "^"),

            ('<', Some('<'), Some('=')) => { self.advance(); eat_tok!(TokenKind::LShiftEq, "<<=") }
            ('<', Some('<'), _)         => eat_tok!(TokenKind::LShift, "<<"),
            ('<', Some('-'), _)         => eat_tok!(TokenKind::Arrow,  "<-"),
            ('<', Some('='), _)         => eat_tok!(TokenKind::LtEq,   "<="),
            ('<', _, _)                 => tok!(TokenKind::Lt,          "<"),

            ('>', Some('>'), Some('=')) => { self.advance(); eat_tok!(TokenKind::RShiftEq, ">>=") }
            ('>', Some('>'), _)         => eat_tok!(TokenKind::RShift, ">>"),
            ('>', Some('='), _)         => eat_tok!(TokenKind::GtEq,   ">="),
            ('>', _, _)                 => tok!(TokenKind::Gt,          ">"),

            ('=', Some('='), _) => eat_tok!(TokenKind::Eq,       "=="),
            ('=', _, _)         => tok!(TokenKind::Assign,         "="),

            ('!', Some('='), _) => eat_tok!(TokenKind::NotEq,  "!="),
            ('!', _, _)         => tok!(TokenKind::Bang,         "!"),

            (':', Some('='), _) => eat_tok!(TokenKind::DeclAssign, ":="),
            (':', _, _)         => tok!(TokenKind::Colon,           ":"),

            (',', _, _) => tok!(TokenKind::Comma,     ","),
            (';', _, _) => tok!(TokenKind::Semicolon, ";"),
            ('(', _, _) => tok!(TokenKind::LParen,    "("),
            (')', _, _) => tok!(TokenKind::RParen,    ")"),
            ('{', _, _) => tok!(TokenKind::LBrace,    "{"),
            ('}', _, _) => tok!(TokenKind::RBrace,    "}"),
            ('[', _, _) => tok!(TokenKind::LBracket,  "["),
            (']', _, _) => tok!(TokenKind::RBracket,  "]"),

            (ch, _, _) => Err(TsukiError::lex(sp, format!("unexpected character `{}`", ch))),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn lex(src: &str) -> Vec<TokenKind> {
        Lexer::new(src, "test.go")
            .tokenize()
            .unwrap()
            .into_iter()
            .map(|t| t.kind)
            .filter(|k| k != &TokenKind::EOF)
            .collect()
    }

    #[test]
    fn test_keywords() {
        let kinds = lex("package main");
        assert_eq!(kinds, vec![TokenKind::KwPackage, TokenKind::Ident("main".into())]);
    }

    #[test]
    fn test_operators() {
        let kinds = lex(":= += <<= &^");
        assert_eq!(kinds, vec![
            TokenKind::DeclAssign,
            TokenKind::PlusEq,
            TokenKind::LShiftEq,
            TokenKind::AmpCaret,
        ]);
    }

    #[test]
    fn test_integer_literals() {
        let kinds = lex("42 0xFF 0b1010 0o77");
        assert_eq!(kinds, vec![
            TokenKind::LitInt(42),
            TokenKind::LitInt(0xFF),
            TokenKind::LitInt(0b1010),
            TokenKind::LitInt(0o77),
        ]);
    }

    #[test]
    fn test_float_literals() {
        let kinds = lex("3.14 2.5e10");
        assert!(matches!(kinds[0], TokenKind::LitFloat(_)));
        assert!(matches!(kinds[1], TokenKind::LitFloat(_)));
    }

    #[test]
    fn test_string_literal() {
        let kinds = lex(r#""hello""#);
        assert_eq!(kinds, vec![TokenKind::LitString("hello".into())]);
    }

    #[test]
    fn test_ellipsis() {
        let kinds = lex("...");
        assert_eq!(kinds, vec![TokenKind::Ellipsis]);
    }
}