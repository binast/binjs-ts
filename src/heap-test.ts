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
    });
});
