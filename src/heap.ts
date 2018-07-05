import * as assert from 'assert';

// A Heapable can only be used in one Heap at a time.
export type Heapable = {
    heap_index: number;
    heap_value: number;
}

// Max-heap
export class Heap<T extends Heapable> {
    v: T[];

    constructor() {
        this.v = [];
    }

    update(h: T, new_value: number): void {
        assert(this.v[h.heap_index] === h);
        if (new_value < h.heap_value) {
            h.heap_value = new_value;
            this.decreased_at(h.heap_index);
        }
        else if (new_value > h.heap_value) {
            h.heap_value = new_value;
            this.increased_at(h.heap_index);
        }
    }

    decreased(h: T): void {
        assert(this.v[h.heap_index] === h);
        this.decreased_at(h.heap_index);
    }

    increased(h: T): void {
        assert(this.v[h.heap_index] === h);
        this.increased_at(h.heap_index);
    }

    private increased_at(i: number): void {
        while (i != 0) {
            let parent = (i & ~1) >> 1;
            if (this.v[i] && this.v[parent].heap_value > this.v[i].heap_value) {
                break;
            }
            this.swap(parent, i);
            i = parent;
        }
    }

    remove(h: T): void {
        // This uses 'undefined' as a sentinel that's greater than any other value.
        assert(this.v[h.heap_index] === h);
        this.v[h.heap_index] = undefined;
        this.increased_at(h.heap_index);
        this.pop();
        h.heap_index = -1;
    }

    add(h: T): void {
        h.heap_index = this.v.length;
        this.v.push(h);
        this.increased(h);
    }

    peek(): T {
        return this.v[0];
    }

    pop(): T {
        if (this.v.length == 0) {
            return undefined;
        }
        let result;
        if (this.v.length == 1) {
            result = this.v[0];
            this.v = [];
        } else {
            result = this.v[0];
            this.v[0] = this.v.pop();
            this.decreased_at(0);
        }
        result.heap_index = -1;
        return result;
    }

    private swap(i: number, j: number) {
        const tmp = this.v[i];
        this.v[i] = this.v[j];
        this.v[j] = tmp;
        this.v[i].heap_index = i;
        this.v[j].heap_index = j;
    }

    // Heapifies a subheap. Sub-sub heaps are assumed to be valid heaps.
    private decreased_at(i: number): void {
        while (true) {
            const left = i << 1 + 1;
            const right = i << 1 + 2
            let largest = i;
            if (left < this.v.length && this.v[left].heap_value > this.v[largest].heap_value) {
                largest = left;
            }
            if (right < this.v.length && this.v[right].heap_value > this.v[largest].heap_value) {
                largest = right;
            }
            if (largest === i) {
                break;
            }
            this.swap(i, largest);
            i = largest;
        }
    }
}
