// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit :: jsx :: ast
// ─────────────────────────────────────────────────────────────────────────────

/// A JSX element node in the virtual DOM tree.
#[derive(Debug, Clone)]
pub enum JsxNode {
    /// <tag attr="val">...children...</tag>
    Element {
        tag:      String,
        attrs:    Vec<JsxAttr>,
        children: Vec<JsxNode>,
    },
    /// <tag attr="val" />
    SelfClosing {
        tag:   String,
        attrs: Vec<JsxAttr>,
    },
    /// Raw text between tags.
    Text(String),
    /// {expression} — kept as raw JS string for browser-side evaluation.
    Expr(String),
    /// A fragment <>...</>
    Fragment(Vec<JsxNode>),
}

#[derive(Debug, Clone)]
pub struct JsxAttr {
    pub name:  String,
    pub value: JsxAttrValue,
}

#[derive(Debug, Clone)]
pub enum JsxAttrValue {
    /// attr="string literal"
    Str(String),
    /// attr={expression}
    Expr(String),
    /// bare attr (boolean true)
    Bool,
}

// ─── Import declarations ───────────────────────────────────────────────────────

/// import { Api, Json, Serial } from 'tsuki-webkit'
#[derive(Debug, Clone)]
pub struct WebkitImport {
    /// The names imported: Api, Json, Serial, …
    pub names: Vec<String>,
    /// Source module string.
    pub from:  String,
}

// ─── Api route extracted from top-level JS ────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ApiRoute {
    pub method: HttpMethod,
    pub path:   String,
    /// Raw JS body of the handler arrow function — compiled to C++ handler.
    pub body:   String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpMethod { Get, Post, Put, Delete }

impl HttpMethod {
    pub fn as_cpp(&self) -> &'static str {
        match self {
            Self::Get    => "HTTP_GET",
            Self::Post   => "HTTP_POST",
            Self::Put    => "HTTP_PUT",
            Self::Delete => "HTTP_DELETE",
        }
    }
}

// ─── Top-level component ──────────────────────────────────────────────────────

/// Result of parsing a single .jsx file.
#[derive(Debug, Clone)]
pub struct JsxComponent {
    /// Component function name (from `export default function name()`)
    pub name:       String,
    /// Parsed imports
    pub imports:    Vec<WebkitImport>,
    /// Api routes extracted from the JS logic block
    pub api_routes: Vec<ApiRoute>,
    /// Additional JS to embed in the browser (non-Api logic)
    pub client_js:  String,
    /// The root JSX return value
    pub root:       JsxNode,
}