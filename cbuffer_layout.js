import { MemberVariable, BuiltinType, ArrayType, StructType } from './cbuffer_parser.js';

export class CBufferLayoutMember extends MemberVariable {
    constructor(type, name, offset, size = 0) {
        super(type, name);
        this.offset = offset;
        this.submembers = [];
        this.size = size;
        this.totalSubmemberCount = 0;
        this.isCBuffer = false;
        this.padding = 0;
    }
    PushSubmember(m) {
        if (this.submembers.length > 0) {
            let last = this.submembers[this.submembers.length - 1];
            let padding = m.offset - (last.offset + last.size);
            last.padding = padding;
            // NOTE: propagate padding back into last array member, makes it easier to access later
            if (last.type instanceof ArrayType) {
                last.submembers[last.submembers.length - 1].padding = padding;
            }
        }
        this.submembers.push(m);
        if (m.type instanceof ArrayType)
            this.totalSubmemberCount += m.totalSubmemberCount;
        else if (m.type instanceof StructType)
            this.totalSubmemberCount += m.totalSubmemberCount + 1;
        else
            this.totalSubmemberCount++;
    }
}
// TODO: we could easily make a layout algorithm for StructuredBuffers
export class CBufferLayoutAlgorithm {
    constructor(cbuffers) {
        this.cbuffers = cbuffers;
        this.out_cbuffer_layouts = [];
        this.curOffset = 0;
    }
    AlignOffsetTo16() {
        return this.curOffset = (this.curOffset + 15) & ~15;
    }
    AlignOffsetTo(align) {
        return this.curOffset = (this.curOffset + (align - 1)) & ~(align - 1);
    }
    AlignValueTo(value, align) {
        return (value + (align - 1)) & ~(align - 1);
    }
    LayoutMemberType(type, name, parent) {
        if (type instanceof BuiltinType) {
            this.AlignOffsetTo(type.alignment); // base type alignment
            let size = type.elementsize * type.vectorsize;
            if (Math.trunc((this.curOffset + size - 1) / 16) > Math.trunc(this.curOffset / 16)) // if we cross a 16 byte boundary, align
                this.AlignOffsetTo16();
            parent.PushSubmember(new CBufferLayoutMember(type, name, this.curOffset, size));
            this.curOffset += size;
        }
        else if (type instanceof ArrayType) {
            this.AlignOffsetTo16();
            let startOffset = this.curOffset;
            let array = new CBufferLayoutMember(type, name, this.curOffset);
            for (let i = 0; i < type.arraySize; i++) {
                this.AlignOffsetTo16();
                this.LayoutMemberType(type.elementType, name + '[' + String(i) + ']', array);
            }
            array.size = this.curOffset - startOffset;
            parent.PushSubmember(array);
        }
        else if (type instanceof StructType) {
            let struct = this.LayoutStructType(type, name, parent);
            parent.PushSubmember(struct);
        }
    }
    LayoutStructType(type, name, parent = null) {
        this.AlignOffsetTo16();
        let startOffset = this.curOffset;
        let layout = new CBufferLayoutMember(type, name, this.curOffset);
        for (let member of type.members) {
            this.LayoutMemberType(member.type, member.name, layout);
        }
        // NOTE: Unlike C and structured buffers, the size of a struct does *not* have to be a multiple
        //       of the largest member alignment, so a struct with a double and a float is still 12 bytes, not 16.
        layout.size = this.curOffset - startOffset;
        return layout;
    }
    GenerateLayout() {
        for (let buffer of this.cbuffers) {
            let layout = this.LayoutStructType(buffer.type, buffer.name);
            this.out_cbuffer_layouts.push(layout);
            layout.isCBuffer = true;
        }
        return this.out_cbuffer_layouts;
    }
};
