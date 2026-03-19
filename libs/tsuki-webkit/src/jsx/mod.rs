pub mod ast;
pub mod lexer;
pub mod parser;

use crate::error::Result;
use ast::JsxComponent;

/// Parse a .jsx source string into a JsxComponent.
pub fn parse(src: &str) -> Result<JsxComponent> {
    let tokens = lexer::lex(src)?;
    parser::Parser::new(tokens).parse()
}