package checker

import (
	"testing"

	"github.com/microsoft/typescript-go/internal/ast"
)

// instantiatedTargetIsCyclic is the pathology test getTypeOfInstantiatedSymbol
// gates on. Cross-checker SymbolHandle reuse is the only producer of a closed
// links.target chain and no public-API call sequence constructs one on demand,
// so the branch is pinned here against hand-built links instead.
//
// Run: go test ./internal/checker/ -run TestInstantiatedTargetIsCyclic
func TestInstantiatedTargetIsCyclic(t *testing.T) {
	t.Parallel()

	sym := func(name string) *ast.Symbol { return &ast.Symbol{Name: name} }

	t.Run("no target", func(t *testing.T) {
		c := &Checker{}
		a := sym("a")
		if c.instantiatedTargetIsCyclic(a) {
			t.Error("a symbol with no links entry reported cyclic")
		}
	})

	t.Run("acyclic chain", func(t *testing.T) {
		c := &Checker{}
		a, b, d := sym("a"), sym("b"), sym("d")
		c.valueSymbolLinks.Get(a).target = b
		c.valueSymbolLinks.Get(b).target = d
		for _, s := range []*ast.Symbol{a, b, d} {
			if c.instantiatedTargetIsCyclic(s) {
				t.Errorf("acyclic chain reported cyclic from %s", s.Name)
			}
		}
	})

	t.Run("self loop", func(t *testing.T) {
		c := &Checker{}
		a := sym("a")
		c.valueSymbolLinks.Get(a).target = a
		if !c.instantiatedTargetIsCyclic(a) {
			t.Error("self-referencing target not detected")
		}
	})

	t.Run("two-symbol loop", func(t *testing.T) {
		c := &Checker{}
		a, b := sym("a"), sym("b")
		c.valueSymbolLinks.Get(a).target = b
		c.valueSymbolLinks.Get(b).target = a
		if !c.instantiatedTargetIsCyclic(a) || !c.instantiatedTargetIsCyclic(b) {
			t.Error("two-symbol loop not detected")
		}
	})

	// Odd-length loop with a tail into it: the tortoise enters the cycle after
	// the hare, which is the case a naive single-pointer walk misses.
	t.Run("tail into odd loop", func(t *testing.T) {
		c := &Checker{}
		tail, x, y, z := sym("tail"), sym("x"), sym("y"), sym("z")
		c.valueSymbolLinks.Get(tail).target = x
		c.valueSymbolLinks.Get(x).target = y
		c.valueSymbolLinks.Get(y).target = z
		c.valueSymbolLinks.Get(z).target = x
		if !c.instantiatedTargetIsCyclic(tail) {
			t.Error("loop reached through a tail not detected")
		}
	})

	// The guard must not materialize links entries while walking: a fabricated
	// chain end stays absent from valueSymbolLinks.
	t.Run("walk does not create links", func(t *testing.T) {
		c := &Checker{}
		a, b := sym("a"), sym("b")
		c.valueSymbolLinks.Get(a).target = b
		if c.instantiatedTargetIsCyclic(a) {
			t.Fatal("acyclic chain reported cyclic")
		}
		if c.valueSymbolLinks.Has(b) {
			t.Error("walking the chain materialized a links entry for the target")
		}
	})
}
