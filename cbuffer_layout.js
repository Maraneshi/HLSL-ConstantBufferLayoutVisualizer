import { MemberVariable, BuiltinType, ArrayType, StructType } from './cbuffer_parser.js';


// TODO: rewrite layout engine to be configurable by a rule set
// maybe this isn't a good idea and ends up unreadable, will see how it goes
// first pass can figure out individual alignments and sizes, second pass can do actual layout with padding
// should we apply alignment rules for scalar, vector and matrix types at parsing? have a ScalarAlignment, VKBaseAlignment, etc. member, then pick the correct one during layouting
//
// note that "relaxed" std430 layout is weird, a struct with a float3 in it seems to still have 16 byte alignment on DXC (seems like glslang --hlsl-offsets agrees)
// from Vulkan spec: inner structs have base alignment and thus must use the largest base alignment of their members even if those are *actually* laid out according to scalar alignment (for relaxed rules)
// same thing most likely applies to relaxed std140 and possibly also arrays, need to do tests
// glslang --hlsl-offsets does the incredibly confusing thing where it applies relaxed layout to all the members, but the struct itself has a size as if it was *not* laid out with relaxed rules
// https://docs.vulkan.org/guide/latest/shader_memory_layout.html says this confusingly named flag *is* the official way to get relaxed layout rules
// I also need to verify what glslang does with HLSL input, it might actually be different, e.g. because nested struct definitions are possible
// old Vulkan 1.0 spec has the relaxed rule differences explained more thoroughly: https://github.com/KhronosGroup/Vulkan-Docs/blob/1.0/doc/specs/vulkan/chapters/interfaces.txt
// Example test case: https://github.com/Microsoft/DirectXShaderCompiler/blob/2322f53773fa6e1c449046e091fe18415ae65d57/docs/SPIR-V.rst#memory-layout-rules
// DXC has *changed* scalar layout rules since 1.8.2505 to be C rules, see https://github.com/microsoft/DirectXShaderCompiler/issues/7894
// 
// currently empty structs fail our layout comparison engine! 
// double check empty struct layout, Vulkan says for base alignment the struct has alignment of the smallest possible type according to the SPIR-V caps enabled
// empty structs are size 1 in C++, 0 in Vulkan/D3D HLSL and invalid in C (GCC and Clang do compile it to size 0 though, MSVC refuses)
// we may not want to support them at all for the above reasons
// 
// Test straddling rules:
// struct {
//   float a;
//   struct {
//     float b;
//     float2 c; 
//   };
// };
// 
// Test relaxed rules:
// struct {
//   struct Test {
//     float a;
//     float3 b;
//   };
//   float c;
//   float3 d;
// };

export class BufferLayoutMember extends MemberVariable {
    constructor(type, name, offset, size = 0) {
        super(type, name);
        this.offset = offset;
        this.submembers = [];
        this.size = size;
        this.padding = 0;
        this.isGlobal = false;
    }
    SetPadding(padding) {
        this.padding = padding;
        // NOTE: propagate padding back into last array member, makes it easier to access later
        if (this.type instanceof ArrayType)
            this.submembers[this.submembers.length - 1].padding = padding;
    }
    PushSubmember(m) {
        if (this.submembers.length > 0) {
            let last = this.submembers[this.submembers.length - 1];
            let padding = m.offset - (last.offset + last.size);
            last.SetPadding(padding);
        }
        this.submembers.push(m);
    }
}

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
        if (align == 0)
            return this.curOffset;
        else
            return this.curOffset = (this.curOffset + (align - 1)) & ~(align - 1);
    }
    LayoutMemberType(type, name, parent) {
        if (type instanceof BuiltinType) {
            this.AlignOffsetTo(type.alignment); // base type alignment
            let size = type.elementsize * type.vectorsize;
            if (Math.trunc((this.curOffset + size - 1) / 16) > Math.trunc(this.curOffset / 16)) // if we cross a 16 byte boundary, align
                this.AlignOffsetTo16();
            parent.PushSubmember(new BufferLayoutMember(type, name, this.curOffset, size));
            this.curOffset += size;
        }
        else if (type instanceof ArrayType) {
            this.AlignOffsetTo16();
            let startOffset = this.curOffset;
            let array = new BufferLayoutMember(type, name, this.curOffset);
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
        let layout = new BufferLayoutMember(type, name, this.curOffset);
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
            layout.isCBuffer = true;
            layout.isGlobal = true;
            this.out_cbuffer_layouts.push(layout);
        }
        return this.out_cbuffer_layouts;
    }
};

export class StructuredBufferLayoutAlgorithm {
    constructor(buffers) {
        this.buffers = buffers;
        this.out_buffer_layouts = [];
        this.curOffset = 0;
    }
    AlignOffsetTo(align) {
        if (align == 0)
            return this.curOffset;
        else
            return this.curOffset = (this.curOffset + (align - 1)) & ~(align - 1);
    }
    LayoutMemberType(type, name, parent) {
        this.AlignOffsetTo(type.alignment); // align start to type alignment
        let startOffset = this.curOffset;
        let member = new BufferLayoutMember(type, name, this.curOffset);
        if (type instanceof BuiltinType) {
            let size = type.elementsize * type.vectorsize;
            this.curOffset += size;
        }
        else if (type instanceof ArrayType) {
            for (let i = 0; i < type.arraySize; i++) {
                this.LayoutMemberType(type.elementType, name + '[' + String(i) + ']', member);
            }
        }
        else if (type instanceof StructType) {
            for (let submember of type.members) {
                this.LayoutMemberType(submember.type, submember.name, member);
            }
        }
        member.size = this.curOffset - startOffset;

        // NOTE: Structs can have padding at the end because type size must be multiple of alignment.
        //       We count that padding towards the last member of the struct and then align the size of the struct.
        this.AlignOffsetTo(type.alignment); // align end to multiple of alignment
        let endAlignmentPadding = this.curOffset - startOffset - member.size;
        if (type instanceof StructType) {
            let lastSubmember = member.submembers[member.submembers.length - 1];
            lastSubmember?.SetPadding(endAlignmentPadding);
            member.size += endAlignmentPadding; // size for structs does contain the padding
        }

        parent?.PushSubmember(member);
        return member;
    }
    ComputeMemberAlignments(type) {
        if (type instanceof ArrayType) {
            type.alignment = this.ComputeMemberAlignments(type.elementType);
        }
        else if (type instanceof StructType) {
            let largest_alignment = 0;
            for (let member of type.members) {
                largest_alignment = Math.max(largest_alignment, this.ComputeMemberAlignments(member.type));
            }
            type.alignment = largest_alignment;
        }
        return type.alignment;
    }
    GenerateLayout() {
        for (let buffer of this.buffers) {
            this.ComputeMemberAlignments(buffer.type);
        }
        for (let buffer of this.buffers) {
            let layout = this.LayoutMemberType(buffer.type, buffer.name);
            layout.isSBuffer = true;
            layout.isGlobal = true;
            this.out_buffer_layouts.push(layout);
        }
        return this.out_buffer_layouts;
    }
};

export class BufferLayoutRules {
    StructAlignSize = false; // SB, ?
    ArrayAlignSize = false; // SB, ?
    VectorAlignSize = false; // not sure if this is true in any layout
    StructBaseAlignment = false; // std430/140
    VectorBaseAlignment = false; // non-relaxed std430/140
    StructForceBaseSize = false; // glslang --hlsloffsets
    VectorStraddlingRules = false; // std140, CBV, relaxed std430
    StructAlign16 = false; // std140, CBV
    ArrayAlign16 = false; // std140, CBV
    MatrixFallsBackToVector = false; // SB, CBV
}
export class GenericBufferLayoutAlgorithm
{

}