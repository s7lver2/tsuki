// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit :: codegen :: html
//  Converts a JsxNode tree into an HTML string.
// ─────────────────────────────────────────────────────────────────────────────

use crate::jsx::ast::{JsxNode, JsxAttr, JsxAttrValue};
use crate::error::Result;

// HTML void elements — never have closing tags.
const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
];

/// Map JSX attribute name to its HTML equivalent.
fn map_attr_name(name: &str) -> &str {
    match name {
        "className"    => "class",
        "htmlFor"      => "for",
        "tabIndex"     => "tabindex",
        "readOnly"     => "readonly",
        "autoFocus"    => "autofocus",
        "autoComplete" => "autocomplete",
        "crossOrigin"  => "crossorigin",
        "httpEquiv"    => "http-equiv",
        "contentEditable" => "contenteditable",
        other          => other,
    }
}

/// Render a single JsxAttr to an HTML attribute string.
fn render_attr(attr: &JsxAttr) -> String {
    let name = map_attr_name(&attr.name);
    // Skip React-specific non-HTML attributes
    if name.starts_with("on") && name.len() > 2 {
        // Event handler: onClick → onclick with inline JS
        let event = name.to_lowercase();
        return match &attr.value {
            JsxAttrValue::Expr(expr) => format!(" {}=\"{}\"", event, escape_attr(expr)),
            JsxAttrValue::Str(s)     => format!(" {}=\"{}\"", event, escape_attr(s)),
            JsxAttrValue::Bool       => format!(" {}=\"true\"", event),
        };
    }
    match &attr.value {
        JsxAttrValue::Str(s)  => format!(" {}=\"{}\"", name, escape_attr(s)),
        JsxAttrValue::Expr(e) => {
            // Static expressions: keep as placeholder text for IDE preview;
            // In production, they're filled via JS fetch.
            format!(" {}=\"{{{{ {} }}}}\"", name, e)
        }
        JsxAttrValue::Bool    => format!(" {}", name),
    }
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('"', "&quot;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
}

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
}

fn is_void(tag: &str) -> bool {
    VOID_ELEMENTS.contains(&tag.to_lowercase().as_str())
}

/// Render a JsxNode to an HTML string.
pub fn render_node(node: &JsxNode, indent: usize) -> Result<String> {
    let pad = "  ".repeat(indent);
    match node {
        JsxNode::Text(t) => Ok(format!("{}{}", pad, escape_text(t))),

        JsxNode::Expr(e) => {
            // Render expression as a span with a data attribute for JS hydration
            Ok(format!("{}<span data-expr=\"{}\" class=\"tsuki-expr\"></span>", pad, escape_attr(e)))
        }

        JsxNode::SelfClosing { tag, attrs } => {
            let tag_lc = tag.to_lowercase();
            let attrs_str: String = attrs.iter().map(render_attr).collect();
            if is_void(&tag_lc) {
                Ok(format!("{}<{}{}>", pad, tag_lc, attrs_str))
            } else {
                Ok(format!("{}<{}{} />", pad, tag_lc, attrs_str))
            }
        }

        JsxNode::Element { tag, attrs, children } => {
            let tag_lc = tag.to_lowercase();
            let attrs_str: String = attrs.iter().map(render_attr).collect();

            if is_void(&tag_lc) {
                return Ok(format!("{}<{}{}>", pad, tag_lc, attrs_str));
            }

            if children.is_empty() {
                return Ok(format!("{}<{}{}></{}>", pad, tag_lc, attrs_str, tag_lc));
            }

            let mut out = format!("{}<{}{}>\n", pad, tag_lc, attrs_str);
            for child in children {
                out.push_str(&render_node(child, indent + 1)?);
                out.push('\n');
            }
            out.push_str(&format!("{}</{}>", pad, tag_lc));
            Ok(out)
        }

        JsxNode::Fragment(children) => {
            let mut out = String::new();
            for child in children {
                out.push_str(&render_node(child, indent)?);
                out.push('\n');
            }
            Ok(out)
        }
    }
}

/// Render the root JsxNode to a complete HTML body string.
pub fn render(root: &JsxNode) -> Result<String> {
    render_node(root, 0)
}