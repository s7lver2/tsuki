// tsuki-webkit — lexer.rs
// Tokenises a JSX/JS source file from scratch, no regex.

use crate::error::WebkitError;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    // JS / JSX structural
    Import,
    Export,
    Default,
    From,
    Return,
    Const,
    Let,
    Var,
    Function,
    Arrow,            // =>
    // JSX
    TagOpen,          // <
    TagClose,         // >
    TagSelfClose,     // />
    TagClosingSlash,  // </
    // Literals / atoms
    Ident(String),
    Str(String),
    Number(String),
    // Punctuation
    LBrace,           // {
    RBrace,           // }
    LParen,           // (
    RParen,           // )
    Equals,           // =
    Semicolon,        // ;
    Comma,            // ,
    Dot,              // .
    Colon,            // :
    // Misc
    Text(String),     // raw text inside JSX elements
    Whitespace,
    Newline,
    Comment(String),
    Eof,
}

#[derive(Debug, Clone)]
pub struct Span {
    pub line: usize,
    pub col:  usize,
}

#[derive(Debug, Clone)]
pub struct Tok {
    pub kind: Token,
    pub span: Span,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, WebkitError> {
    let chars: Vec<char> = src.chars().collect();
    let mut tokens       = Vec::new();
    let mut i            = 0usize;
    let mut line         = 1usize;
    let mut col          = 1usize;

    macro_rules! push {
        ($kind:expr) => {
            tokens.push(Tok { kind: $kind, span: Span { line, col } })
        };
    }

    while i < chars.len() {
        let c = chars[i];

        // ── Newline ─────────────────────────────────────────────────────────
        if c == '\n' {
            push!(Token::Newline);
            line += 1; col = 1; i += 1;
            continue;
        }

        // ── Whitespace ───────────────────────────────────────────────────────
        if c.is_whitespace() {
            i += 1; col += 1;
            continue;
        }

        // ── Single-line comment ──────────────────────────────────────────────
        if c == '/' && chars.get(i + 1) == Some(&'/') {
            let start = i;
            while i < chars.len() && chars[i] != '\n' { i += 1; }
            let text: String = chars[start..i].iter().collect();
            push!(Token::Comment(text));
            continue;
        }

        // ── Block comment ────────────────────────────────────────────────────
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            let start = i;
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i+1] == '/') {
                if chars[i] == '\n' { line += 1; col = 1; }
                i += 1;
            }
            i += 2; // consume */
            let text: String = chars[start..i].iter().collect();
            push!(Token::Comment(text));
            continue;
        }

        // ── String literals (single or double quote) ──────────────────────
        if c == '"' || c == '\'' || c == '`' {
            let quote = c;
            i += 1; col += 1;
            let mut s = String::new();
            while i < chars.len() && chars[i] != quote {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    s.push(chars[i]); s.push(chars[i+1]);
                    i += 2; col += 2;
                } else {
                    s.push(chars[i]); i += 1; col += 1;
                }
            }
            i += 1; col += 1; // closing quote
            push!(Token::Str(s));
            continue;
        }

        // ── JSX closing tag </  ───────────────────────────────────────────
        if c == '<' && chars.get(i + 1) == Some(&'/') {
            push!(Token::TagClosingSlash);
            i += 2; col += 2;
            continue;
        }

        // ── JSX self-close />  ────────────────────────────────────────────
        if c == '/' && chars.get(i + 1) == Some(&'>') {
            push!(Token::TagSelfClose);
            i += 2; col += 2;
            continue;
        }

        // ── Single chars ──────────────────────────────────────────────────
        let single = match c {
            '<' => Some(Token::TagOpen),
            '>' => Some(Token::TagClose),
            '{' => Some(Token::LBrace),
            '}' => Some(Token::RBrace),
            '(' => Some(Token::LParen),
            ')' => Some(Token::RParen),
            '=' => Some(Token::Equals),
            ';' => Some(Token::Semicolon),
            ',' => Some(Token::Comma),
            '.' => Some(Token::Dot),
            ':' => Some(Token::Colon),
            _   => None,
        };
        if let Some(tok) = single {
            push!(tok);
            i += 1; col += 1;
            continue;
        }

        // ── Arrow =>  ────────────────────────────────────────────────────
        if c == '=' && chars.get(i + 1) == Some(&'>') {
            push!(Token::Arrow);
            i += 2; col += 2;
            continue;
        }

        // ── Numbers ──────────────────────────────────────────────────────
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1; col += 1;
            }
            let num: String = chars[start..i].iter().collect();
            push!(Token::Number(num));
            continue;
        }

        // ── Identifiers & keywords ────────────────────────────────────────
        if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$') {
                i += 1; col += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let tok = match word.as_str() {
                "import"   => Token::Import,
                "export"   => Token::Export,
                "default"  => Token::Default,
                "from"     => Token::From,
                "return"   => Token::Return,
                "const"    => Token::Const,
                "let"      => Token::Let,
                "var"      => Token::Var,
                "function" => Token::Function,
                _          => Token::Ident(word),
            };
            push!(tok);
            continue;
        }

        // Anything else — skip
        i += 1; col += 1;
    }

    push!(Token::Eof);
    Ok(tokens)
}
