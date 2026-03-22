// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: parser :: ast
//  Abstract Syntax Tree for the Go subset supported by tsuki.
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::Span;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum Type {
    // Primitive
    Bool,
    Int, Int8, Int16, Int32, Int64,
    Uint, Uint8, Uint16, Uint32, Uint64,
    Uintptr,
    Float32, Float64,
    Complex64, Complex128,
    Byte,   // alias uint8
    Rune,   // alias int32
    String,

    // Composite
    Ptr     (Box<Type>),
    Array   { len: Option<usize>, elem: Box<Type> },
    Slice   (Box<Type>),
    Map     { key: Box<Type>, val: Box<Type> },
    Chan    { dir: ChanDir,    elem: Box<Type> },
    Func    { params: Vec<Type>, results: Vec<Type> },
    Struct  (Vec<Field>),
    Iface   (Vec<Method>),  // simplified interface

    // User-defined or qualified (pkg.Name)
    Named(String),

    // Used internally
    Void,
    Infer,  // let the codegen infer (auto)
}

#[derive(Debug, Clone, PartialEq)]
pub enum ChanDir { Both, Send, Recv }

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub name: Option<String>,
    pub ty:   Type,
    pub tag:  Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Method {
    pub name: String,
    pub sig:  FuncSig,
}

impl Type {
    /// Emit the equivalent C++ type string for Arduino / AVR-GCC.
    ///
    /// Returns `Cow::Borrowed` for all primitive types (zero allocation),
    /// and `Cow::Owned` only for compound types that require formatting.
    pub fn to_cpp(&self) -> String {
        self.to_cpp_str().into_owned()
    }

    /// Like `to_cpp` but returns a `Cow` — avoids allocation for primitive types.
    pub fn to_cpp_str(&self) -> std::borrow::Cow<'static, str> {
        use std::borrow::Cow::*;
        match self {
            Type::Void                    => Borrowed("void"),
            Type::Bool                    => Borrowed("bool"),
            Type::Int                     => Borrowed("int"),
            Type::Int8                    => Borrowed("int8_t"),
            Type::Int16                   => Borrowed("int16_t"),
            Type::Int32 | Type::Rune      => Borrowed("int32_t"),
            Type::Int64                   => Borrowed("int64_t"),
            Type::Uint                    => Borrowed("unsigned int"),
            Type::Uint8 | Type::Byte      => Borrowed("uint8_t"),
            Type::Uint16                  => Borrowed("uint16_t"),
            Type::Uint32                  => Borrowed("uint32_t"),
            Type::Uint64                  => Borrowed("uint64_t"),
            Type::Uintptr                 => Borrowed("uintptr_t"),
            Type::Float32                 => Borrowed("float"),
            Type::Float64                 => Borrowed("double"),
            Type::String                  => Borrowed("String"),
            Type::Infer                   => Borrowed("auto"),
            Type::Ptr(inner)              => Owned(format!("{}*", inner.to_cpp())),
            Type::Slice(elem)             => Owned(format!("{}*", elem.to_cpp())),
            Type::Array { len: Some(n), elem } => Owned(format!("{} /* [{}] */", elem.to_cpp(), n)),
            Type::Array { len: None, elem }    => Owned(format!("{}*", elem.to_cpp())),
            Type::Named(n)  => Owned(n.split('.').last().unwrap_or(n).to_owned()),
            _               => Borrowed("void* /* unsupported */"),
        }
    }
}

// ── Expressions ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum Expr {
    // Literals
    Int    (i64),
    Float  (f64),
    Str    (String),
    Rune   (char),
    Bool   (bool),
    Nil,

    // Name
    Ident  { name: String, span: Span },

    // Operations
    Binary { op: BinOp, lhs: Box<Expr>, rhs: Box<Expr>, span: Span },
    Unary  { op: UnOp,  expr: Box<Expr>, span: Span },

    // Calls & access
    Call     { func: Box<Expr>, args: Vec<Expr>, span: Span },
    Index    { expr: Box<Expr>, idx:  Box<Expr>, span: Span },
    Slice    { expr: Box<Expr>, lo: Option<Box<Expr>>, hi: Option<Box<Expr>>, span: Span },
    Select   { expr: Box<Expr>, field: String, span: Span },
    TypeAssert { expr: Box<Expr>, ty: Type, span: Span },

    // Composite / func literals
    Composite { ty: Type, elems: Vec<CompElem>, span: Span },
    FuncLit   { sig: FuncSig, body: Block, span: Span },

    // Pre-rendered C++ snippet (internal use by codegen)
    Raw(String),
}

#[derive(Debug, Clone)]
pub struct CompElem {
    pub key: Option<Expr>,
    pub val: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BinOp {
    Add, Sub, Mul, Div, Rem,
    And, Or,
    BitAnd, BitOr, BitXor, BitAndNot, Shl, Shr,
    Eq, Ne, Lt, Le, Gt, Ge,
}

impl BinOp {
    pub fn to_cpp(&self) -> &'static str {
        match self {
            Self::Add    => "+",  Self::Sub => "-",
            Self::Mul    => "*",  Self::Div => "/",  Self::Rem => "%",
            Self::And    => "&&", Self::Or  => "||",
            Self::BitAnd => "&",  Self::BitOr  => "|", Self::BitXor => "^",
            Self::BitAndNot => "&~",
            Self::Shl    => "<<", Self::Shr  => ">>",
            Self::Eq     => "==", Self::Ne   => "!=",
            Self::Lt     => "<",  Self::Le   => "<=",
            Self::Gt     => ">",  Self::Ge   => ">=",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum UnOp { Neg, Not, BitNot, Deref, Addr, Recv }

impl UnOp {
    pub fn to_cpp(&self) -> &'static str {
        match self {
            Self::Neg    => "-", Self::Not    => "!", Self::BitNot => "~",
            Self::Deref  => "*", Self::Addr   => "&", Self::Recv   => "/* <- */",
        }
    }
}

// ── Statements ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Block {
    pub stmts: Vec<Stmt>,
    pub span:  Span,
}

#[derive(Debug, Clone)]
pub enum Stmt {
    // Declarations
    VarDecl   { name: String, ty: Option<Type>, init: Option<Expr>, span: Span },
    ConstDecl { name: String, ty: Option<Type>, val:  Expr,         span: Span },
    ShortDecl { names: Vec<String>, vals: Vec<Expr>,                span: Span },

    // Assignment
    Assign { lhs: Vec<Expr>, rhs: Vec<Expr>, op: AssignOp, span: Span },

    // Inc / dec
    Inc { expr: Expr, span: Span },
    Dec { expr: Expr, span: Span },

    // Control flow
    Return   { vals: Vec<Expr>,         span: Span },
    Break    { label: Option<String>,   span: Span },
    Continue { label: Option<String>,   span: Span },
    Goto     { label: String,           span: Span },
    Label    { name:  String,           span: Span },

    // Structured control
    If     { init: Option<Box<Stmt>>, cond: Expr, then: Block, else_: Option<Box<Stmt>>, span: Span },
    For    { init: Option<Box<Stmt>>, cond: Option<Expr>, post: Option<Box<Stmt>>, body: Block, span: Span },
    Range  { key: Option<String>, val: Option<String>, iter: Expr, body: Block, span: Span },
    Switch { init: Option<Box<Stmt>>, tag: Option<Expr>, cases: Vec<SwitchCase>, span: Span },

    // Concurrency (mapped or stubbed on Arduino)
    Defer { call: Expr, span: Span },
    Go    { call: Expr, span: Span },

    // Plain expression statement
    Expr  { expr: Expr, span: Span },

    // Nested block
    Block(Block),
}

#[derive(Debug, Clone)]
pub struct SwitchCase {
    pub exprs: Vec<Expr>,  // empty ⇒ default
    pub body:  Vec<Stmt>,
    pub span:  Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AssignOp {
    Plain,
    Add, Sub, Mul, Div, Rem,
    BitAnd, BitOr, BitXor, BitAndNot, Shl, Shr,
}

impl AssignOp {
    pub fn to_cpp(&self) -> &'static str {
        match self {
            Self::Plain    => "=",
            Self::Add      => "+=",  Self::Sub    => "-=",
            Self::Mul      => "*=",  Self::Div    => "/=",  Self::Rem  => "%=",
            Self::BitAnd   => "&=",  Self::BitOr  => "|=",  Self::BitXor => "^=",
            Self::BitAndNot => "&=", // closest in C++
            Self::Shl      => "<<=", Self::Shr    => ">>=",
        }
    }
}

// ── Top-level declarations ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct FuncParam {
    pub name:     Option<String>,
    pub ty:       Type,
    pub variadic: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FuncSig {
    pub params:  Vec<FuncParam>,
    pub results: Vec<FuncParam>,
}

#[derive(Debug, Clone)]
pub enum Decl {
    Func {
        name:     String,
        recv:     Option<FuncParam>,
        sig:      FuncSig,
        body:     Option<Block>,
        span:     Span,
    },
    TypeDef  { name: String, ty: Type,         span: Span },
    StructDef{ name: String, fields: Vec<Field>, span: Span },
    Var      { name: String, ty: Option<Type>, init: Option<Expr>, span: Span },
    Const    { name: String, ty: Option<Type>, val:  Expr,         span: Span },
}

// ── Import ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Import {
    pub alias: Option<String>,
    pub path:  String,
}

impl Import {
    /// The local name used to reference this package in Go source.
    pub fn local_name(&self) -> &str {
        if let Some(a) = &self.alias { return a.as_str(); }
        self.path.split('/').last().unwrap_or(&self.path)
    }
}

// ── Program root ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Program {
    pub package: String,
    pub imports: Vec<Import>,
    pub decls:   Vec<Decl>,
}