// Minimal trigger: a function whose parameter is a tuple type, called with an
// empty array literal. The literal is contextually typed as an empty tuple,
// whose type is a cloned tuple reference (Tuple flag on bare *TypeReference
// data). When a type-aware rule asks TNB for that argument's type, the query
// reaches (*Type).ThisType() and dereferences nil.
declare function wantTuple(items: []): void
wantTuple([])
