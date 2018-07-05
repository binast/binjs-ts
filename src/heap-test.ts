import { Heap, Heapable } from './heap';

import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

function v(n: number): Heapable {
    return {
        heap_index: undefined,
        heap_value: n,
    };
}

describe('Heap', () => {
    it('should produce undefined if popped when empty', () => {
        const h = new Heap();
        expect(h.pop()).to.equal(undefined);
    });

    it('should produce the largest values first', () => {
        const h = new Heap();
        h.add(v(3));
        h.add(v(1));
        h.add(v(4));
        h.add(v(3));
        h.add(v(2));
        expect(h.pop().heap_value).to.equal(4);
        expect(h.pop().heap_value).to.equal(3);
        expect(h.pop().heap_value).to.equal(3);
        expect(h.pop().heap_value).to.equal(2);
        expect(h.pop().heap_value).to.equal(1);
        expect(h.pop()).to.equal(undefined);
    });

    it('should bubble up values which increase', () => {
        const h = new Heap();
        const a = v(7);
        const b = v(8);
        h.add(a);
        h.add(b);
        expect(h.peek()).to.equal(b);
        h.update(a, 42);
        expect(h.pop()).to.equal(a);
    });

    it('should push down values which decrease', () => {
        const h = new Heap();
        const a = v(7);
        const b = v(8);
        h.add(a);
        h.add(b);
        expect(h.peek()).to.equal(b);
        h.update(b, 6);
        expect(h.pop()).to.equal(a);
    });
});
