import { StructType, ArrayType, Parser, Lexer, HLSLError } from './cbuffer_parser.js';
import { CBufferLayoutAlgorithm } from './cbuffer_layout.js';

class ColorArray {
    constructor(size, shuffle, shuffle_subdivisions, lightness, saturation) {
        this.shuffle = shuffle;
        this.shuffle_subdivisions = shuffle_subdivisions;
        this.lightness = lightness;
        this.saturation = saturation;
        this.colors = this.GetColorArray(size);
    }
    OklabCHToString(l, c, h) {
        return `oklch(${l} ${c * 100}% ${h})`;
    }
    GetRainbowColor(t) {
        let l = this.lightness;
        let c = this.saturation;
        let h = 360 * t - 70;
        return this.OklabCHToString(l, c, h);
    }
    GetColorArray(dataLength) {
        let colorArray = [];
        for (let i = 0; i < dataLength; i++) {
            let colorPoint = i / dataLength;
            colorArray.push(this.GetRainbowColor(colorPoint));
        }

        // divide evenly into multiple ranges and zip them, in perhaps the most complicated way possible
        if (this.shuffle) {
            let subranges = [];
            let largest_subrange_size = 0;
            let count = 0;
            let running_sum_frac = 0;
            for (let subdiv = 0; subdiv < this.shuffle_subdivisions; subdiv++) {
                subranges.push([]);
                let subdiv_size_full = dataLength / this.shuffle_subdivisions;
                let subdiv_size_floor = Math.floor(subdiv_size_full);
                let subdiv_size_frac = subdiv_size_full - subdiv_size_floor;
                running_sum_frac += subdiv_size_frac;
                let this_subrange_size = subdiv_size_floor;
                if (running_sum_frac > 0.999) {
                    this_subrange_size += 1;
                    running_sum_frac -= 1;
                }
                if (largest_subrange_size < this_subrange_size)
                    largest_subrange_size = this_subrange_size;

                for (let i = 0; i < this_subrange_size; i++) {
                    subranges[subdiv].push(colorArray[count]);
                    count++;
                }
            }

            colorArray = [];
            for (let i = 0; i < largest_subrange_size; i++) {
                for (let j = 0; j < this.shuffle_subdivisions; j++) {
                    if (i < subranges[j].length)
                        colorArray.push(subranges[j][i]);
                }
            }
        }
        return colorArray;
    }
    Get(i) {
        return this.colors[i];
    }
};


function LayoutCountMembers(m, expanded_arrays) {
    let member_count = 0;
    if (m.type instanceof StructType)
        member_count += LayoutCountStructMembers(m, expanded_arrays);
    else if (m.type instanceof ArrayType)
        member_count += LayoutCountArrayMembers(m, expanded_arrays);
    else
        member_count++;
    return member_count;
}
function LayoutCountArrayMembers(array, expanded_arrays) {
    let member_count = 0;
    if (expanded_arrays) {
        for (let m of array.submembers)
            member_count += LayoutCountMembers(m, expanded_arrays);
    }
    else {
        member_count += LayoutCountMembers(array.submembers[0], expanded_arrays);
    }
    return member_count;
}
function LayoutCountStructMembers(struct, expanded_arrays) {
    let member_count = 1;
    for (let m of struct.submembers) {
        member_count += LayoutCountMembers(m, expanded_arrays);
    }
    return member_count;
}

function CreateColoredText(text, color) {
    const span = document.createElement("span");
    span.setAttribute("style", `color:${color}`);
    span.append(text);
    span.original_color = color;
    return span;
}

class StructPrinter {
    constructor(text_node, expanded_arrays, alignment, colors) {
        this.text_node = text_node;
        this.expanded_arrays = expanded_arrays;
        this.alignment = alignment;
        this.colors = colors;
        this.indentation = 0;
        this.color_index = 0;
        this.check_size = 0;
    }
    NextColor() {
        return this.color_index++;
    }
    GetIndentationString() {
        return "    ".repeat(this.indentation);
    }
    AddText(member, str, color_index) {
        let text = CreateColoredText(this.GetIndentationString() + str, this.colors.Get(color_index));
        text.CBV_color_index = color_index;
        this.text_node.appendChild(text);
        member?.CBV_texts.push(text);
    }
    AddAlignedText(member, prefix, suffix, color_index) {
        prefix = this.GetIndentationString() + prefix;
        suffix = " ".repeat(Math.max(this.alignment - prefix.length, 1)) + suffix;
        let text = CreateColoredText(prefix + suffix, this.colors.Get(color_index));
        text.CBV_color_index = color_index;
        this.text_node.appendChild(text);
        member?.CBV_texts.push(text);
    }
    GetOffsetString(offset) {
        return `${String(offset).padStart(6)}`;
    }
    GetSizeString(size) {
        return `${String(size).padStart(4)}`;
    }
    GetPaddingString(padding) {
        return `${padding > 0 ? "+" + String(padding).padStart(2) : ""}`;
    }
    GetOffSizePadString(offset, size, padding) {
        return `${this.GetOffsetString(offset)} ${this.GetSizeString(size)} ${this.GetPaddingString(padding)}`;
    }
    PrintColoredStructLayout(struct) {
        this.text_node.replaceChildren();
        this.AddAlignedText(null, "", `${this.GetOffsetString("offset")} ${this.GetSizeString("size")} +pad\n`);
        this.text_node.lastChild.setAttribute("style", "font-weight: bold;");
        struct.CBV_texts = [];
        this.PrintColoredStructLayoutInternal(struct, null);
        //this.AddAlignedText(null, "size check", `${this.GetOffsetString("")} ${this.GetSizeString(this.check_size)}\n`);
    }
    PrintColoredStructLayoutInternal(struct, parent) {
        let struct_color = this.NextColor();
        this.AddText(struct, `${struct.isCBuffer ? "cbuffer" : "struct"} ${struct.type.name} {\n`, struct_color);
        this.indentation++;
        for (let m of struct.submembers) {
            this.PrintColoredLayoutMember(m, struct);
        }
        this.indentation--;
        if (struct.name != "") {
            if (!this.expanded_arrays && parent && parent.type instanceof ArrayType) {
                this.AddAlignedText(parent, `} ${parent.name}[${parent.submembers.length}];`, `${this.GetOffSizePadString(parent.offset, parent.size, parent.padding)}\n`, struct_color);
            }
            else {
                this.AddAlignedText(struct, `} ${struct.name};`, `${this.GetOffSizePadString(struct.isCBuffer ? "" : struct.offset, struct.size, struct.padding)}\n`, struct_color);
                this.check_size += struct.padding;
            }
        }
        else {
            this.AddAlignedText(struct, "};", `${this.GetOffSizePadString("", struct.size, struct.padding)}\n`, struct_color);
        }
    }
    PrintColoredLayoutMember(member, parent) {
        member.CBV_texts = [];
        if (member.type instanceof StructType) {
            this.PrintColoredStructLayoutInternal(member, parent);
        }
        else if (member.type instanceof ArrayType) {
            if (this.expanded_arrays) {
                for (let m of member.submembers)
                    this.PrintColoredLayoutMember(m, member);
            }
            else {
                this.PrintColoredLayoutMember(member.submembers[0], member);

                if (member.submembers[0].type instanceof StructType)
                    this.check_size -= member.submembers[0].size;
                for (let m of member.submembers) {
                    this.check_size += m.size + m.padding;
                }
            }
        }
        else {
            if (!this.expanded_arrays && parent && parent.type instanceof ArrayType) {
                this.AddAlignedText(parent, `${member.type.name} ${parent.name}[${parent.submembers.length}];`, `${this.GetOffSizePadString(parent.offset, parent.size, parent.padding)}\n`, this.NextColor());
            }
            else {
                this.AddAlignedText(member, `${member.type.name} ${member.name};`, `${this.GetOffSizePadString(member.offset, member.size, member.padding)}\n`, this.NextColor());
                this.check_size += member.size + member.padding;
            }
        }
    }
}

// TODO: can we do this with a CSS sheet and then dynamically adjust that one instead of manually going through each element? but these aren't CSS properties...
//       Apparently some or all of these can be set in CSS instead. We may be able to put "level" in a CSS variable too.

function ApplyThemeOuterRectText(text, dark_theme) {
    if (dark_theme)
        text.setAttribute("fill", "#D4D4D4");
    else
        text.setAttribute("fill", "black");
}
function ApplyThemeOuterRectLine(line, dark_theme) {
    if (dark_theme) {
        line.setAttribute("stroke", "#D4D4D4");
        line.setAttribute("opacity", 0.325);
    }
    else {
        line.setAttribute("stroke", "#777777");
        line.setAttribute("opacity", 0.25);
    }
}

function ApplyThemeInnerRect(rect, text, dark_theme, level) {
    if (dark_theme) {
        rect.setAttribute("fill", "black");
        rect.setAttribute("fill-opacity", 0.2 / (level + 1));
        text?.setAttribute("fill", "#D4D4D4");
    }
    else {
        rect.setAttribute("fill", "white");
        rect.setAttribute("fill-opacity", 0.2 / (level + 1));
        text?.setAttribute("fill", "black");
    }
}

class StructLayoutVisualizer {
    constructor(svg_node, text_node, expanded_arrays, dark_theme, colors) {
        this.text_node = text_node;
        this.svg_node = svg_node;
        this.expanded_arrays = expanded_arrays;
        this.colors = colors;
        this.dark_theme = dark_theme;
        this.color_index = 0;
        this.width_per_byte = 24;
        this.outer_rect_height = 36;
        this.height_per_vector = this.outer_rect_height + 24;
        this.stroke_width = 2;
        this.init_offset_y = 20;
        this.init_offset_x = 16;
        this.level = 0;
    }
    NextColor() {
        return this.color_index++;
    }
    CreateOuterRectGroup(layout) {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        for (let i = 0; i < Math.ceil(layout.size / 16); i++) {
            this.AddRectOuter(group, i * 16);
        }
        this.svg_node.append(group);
    }
    AddRectOuter(group, start_offset) {
        let x = Math.floor(start_offset % 16) * this.width_per_byte + this.init_offset_x;
        let y = Math.floor(start_offset / 16) * this.height_per_vector + this.init_offset_y;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("stroke", "#888888");
        rect.setAttribute("stroke-width", this.stroke_width);
        rect.setAttribute("fill", "none");
        rect.setAttribute("width", 16 * this.width_per_byte);
        rect.setAttribute("height", this.outer_rect_height);
        rect.setAttribute("y", y);
        rect.setAttribute("x", x);
        group.append(rect);
        for (let i = 0; i <= 16; i += 4) {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            ApplyThemeOuterRectText(text, this.dark_theme);
            text.setAttribute("x", this.init_offset_x + i * this.width_per_byte);
            text.setAttribute("y", y - 5);
            text.setAttribute("text-anchor", "middle");
            text.append(String(start_offset + i));
            group.append(text);
            if ((i % 16) != 0) {
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                ApplyThemeOuterRectLine(line, this.dark_theme);
                line.setAttribute("stroke-width", this.stroke_width / 2);
                line.setAttribute("x1", this.init_offset_x + i * this.width_per_byte);
                line.setAttribute("x2", this.init_offset_x + i * this.width_per_byte);
                line.setAttribute("y1", y);
                line.setAttribute("y2", y + this.outer_rect_height);
                group.append(line);
            }
        }
    }
    AddRectInner(color_index, start_offset, size_in_bytes, name, level = this.level) {
        let color = this.colors.Get(color_index);
        let x_offset = Math.floor(start_offset % 16) * this.width_per_byte + this.init_offset_x;
        let y_offset = Math.floor(start_offset / 16) * this.height_per_vector + this.init_offset_y;
        let pad = (this.stroke_width + 1) * level;
        let x = x_offset + pad;
        let y = y_offset + pad;
        let width = size_in_bytes * this.width_per_byte - pad * 2;
        let height = this.outer_rect_height - pad * 2;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        if (this.level == 0)
            rect.setAttribute("opacity", 0.70);
        rect.setAttribute("stroke", color);
        rect.setAttribute("stroke-width", this.stroke_width);
        rect.setAttribute("width", width);
        rect.setAttribute("height", height);
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.CBV_color_index = color_index;
        rect.CBV_level = level;
        this.svg_node.append(rect);
        let text = null;
        if (name) {
            text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", x + width / 2);
            text.setAttribute("y", y + height / 2);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("dominant-baseline", "middle");
            text.setAttribute("font-weight", "bold");
            text.append(name);
            this.svg_node.append(text);
        }
        ApplyThemeInnerRect(rect, text, this.dark_theme, this.level);
        return { rect: rect, text: text };
    }
    AddRectForMember(color_index, member, skip_name = false) {
        member.CBV_rects = [];
        for (let i = 0; i < Math.ceil(member.size / 16); i++) {
            let inner_rect = this.AddRectInner(color_index, member.offset + i * 16, Math.min(member.size - i * 16, 16), skip_name ? null : member.name);
            member.CBV_rects.push(inner_rect);
        }
    }
    VisualizeMember(member, parent) {
        if (member.type instanceof StructType) {
            this.#VisualizeStruct(member, parent);
        }
        else if (member.type instanceof ArrayType) {
            if (this.expanded_arrays) {
                member.CBV_rects = [];
                for (let m of member.submembers)
                    this.VisualizeMember(m, member);
            }
            else {
                this.AddRectForMember(this.NextColor(), member);

                if (member.submembers[0].type instanceof StructType) {
                    this.#VisualizeStruct(member.submembers[0], member);
                }
            }
        }
        else {
            this.AddRectForMember(this.NextColor(), member);
        }
    }
    #VisualizeStruct(struct, parent) {
        if (this.expanded_arrays || !parent || !(parent.type instanceof ArrayType)) {
            this.AddRectForMember(this.NextColor(), struct, true);
        }

        this.level++;
        for (let m of struct.submembers) {
            this.VisualizeMember(m, struct);
        }
        this.level--;
    }

    VisualizeLayout(layout) {
        this.svg_node.replaceChildren();
        this.svg_node.setAttribute("width", 16 * this.width_per_byte + this.init_offset_x * 4);
        this.svg_node.setAttribute("height", Math.ceil(layout.size / 16) * this.height_per_vector + this.init_offset_y);
        this.CreateOuterRectGroup(layout);
        this.#VisualizeStruct(layout, null);
    }
};

export const CBufferVisualizerOptionsDefault = {
    expanded_arrays: true,
    text_alignment: 28,
    color_shuffle: false,
    color_shuffle_subdivisions: 4,
    color_lightness: 0.6,
    color_saturation: 0.6,
    dark_theme: true
};

export class CBufferVisualizer {
    constructor(out_text, out_svg, options) {
        this.out_text = out_text;
        this.out_svg = out_svg;
        this.options = options;
    }
    #GetColors() {
        let start = window.performance.now();
        let member_count = LayoutCountStructMembers(this.layouts[0], this.options.expanded_arrays);
        this.colors = new ColorArray(member_count, this.options.color_shuffle, this.options.color_shuffle_subdivisions, this.options.color_lightness, this.options.color_saturation);
        window.performance.measure("GetColors", { start:start });
    }
    #ReEvaluateColors() {
        let start = window.performance.now();
        this.#GetColors();
        for (const svg_subnode of this.out_svg.children) {
            if (svg_subnode.CBV_color_index != undefined) {
                svg_subnode.setAttribute("stroke", this.colors.Get(svg_subnode.CBV_color_index));
            }
        }
        for (const span of this.out_text.children) {
            if (span.CBV_color_index != undefined) {
                span.style.color = this.colors.Get(span.CBV_color_index);
            }
        }
        window.performance.measure("ReEvaluateColors", { start:start });
    }
    #ApplyTheme() {
        let start = window.performance.now();
        this.#ReEvaluateColors();

        for (const child of this.out_svg.firstChild.children) { // outer rect group
            //if (this.out_svg.firstChild.tagName != "g")
            //    throw "Something went wrong when changing themes";
            if (child.tagName == "text")
                ApplyThemeOuterRectText(child, this.options.dark_theme);
            else if (child.tagName == "line")
                ApplyThemeOuterRectLine(child, this.options.dark_theme);
        }
        for (const svg_subnode of this.out_svg.children) {
            if (svg_subnode.CBV_color_index != undefined) { // inner rect
                let rect_text = svg_subnode.nextElementSibling.tagName == "text" ? svg_subnode.nextElementSibling : null;
                ApplyThemeInnerRect(svg_subnode, rect_text, this.options.dark_theme, svg_subnode.CBV_level);
            }
        }
        for (const span of this.out_text.children) {
            if (span.CBV_color_index != undefined) {
                span.style.color = this.colors.Get(span.CBV_color_index);
            }
        }
        window.performance.measure("ApplyTheme", { start:start });
    }
    #DoColoredText() {
        let start = window.performance.now();
        let printer = new StructPrinter(this.out_text, this.options.expanded_arrays, this.options.text_alignment, this.colors);
        printer.PrintColoredStructLayout(this.layouts[0]);
        window.performance.measure("DoColoredText", { start:start });
    }
    #DoColoredRects() {
        let start = window.performance.now();
        let viz = new StructLayoutVisualizer(this.out_svg, this.out_text, this.options.expanded_arrays, this.options.dark_theme, this.colors);
        viz.VisualizeLayout(this.layouts[0]);
        window.performance.measure("DoColoredRects", { start:start });
    }
    static #RecurseLayout(layout, func) {
        func(layout);
        for (let m of layout.submembers) {
            CBufferVisualizer.#RecurseLayout(m, func);
        }
    }
    #RemoveEventListeners() {
        let start = window.performance.now();

        // disconnect text and rect nodes
        let remove_event_listeners = (member) => {
            if (member.CBV_rects != undefined) {
                for (let rect of member.CBV_rects) {
                    if (rect.rect.CBV_level != 0) {
                        rect.rect.removeEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.rect.removeEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                        rect.text?.removeEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.text?.removeEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                    }
                }
            }
            if (member.CBV_texts != undefined) {
                for (let span of member.CBV_texts) {
                    span.removeEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                    span.removeEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                }
            }
        };

        CBufferVisualizer.#RecurseLayout(this.layouts[0], remove_event_listeners);

        window.performance.measure("RemoveEventListeners", { start: start });
    }
    #AddEventListeners() {
        let start = window.performance.now();

        // connect text and rect nodes for highlighting
        // TODO: it feels cleaner to have it here, but we *could* put this in the StructLayoutVisualizer
        let add_event_listeners = (member) => {
            let selection_bg_color = this.options.dark_theme ? "#04395e60" : "#0060c00a";

            member.CBV_mouseenter = () => {
                if (member.CBV_rects != undefined) {
                    for (let rect of member.CBV_rects) {
                        rect.rect.setAttribute("stroke-width", 5);
                        rect.text?.setAttribute("style", "font-weight: bold;");
                    }
                }
                if (member.CBV_texts != undefined) {
                    for (let span of member.CBV_texts) {
                        span.setAttribute("style", `color: ${span.style.color}; font-weight: bold; background-color: ${selection_bg_color}; `);
                    }
                }
            };
            member.CBV_mouseleave = () => {
                if (member.CBV_rects != undefined) {
                    for (let rect of member.CBV_rects) {
                        rect.rect.setAttribute("stroke-width", 2); // TODO: this must be the same as stroke_width in StructLayoutVisualizer
                        rect.text?.setAttribute("style", "");
                    }
                }
                if (member.CBV_texts != undefined) {
                    for (let span of member.CBV_texts) {
                        span.setAttribute("style", `color: ${span.style.color};`);
                    }
                }
            };

            if (member.CBV_rects != undefined) {
                for (let rect of member.CBV_rects) {
                    if (rect.rect.CBV_level != 0) {
                        rect.rect.addEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.rect.addEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                        rect.text?.addEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.text?.addEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                    }
                }
            }
            if (member.CBV_texts != undefined) {
                for (let span of member.CBV_texts) {
                    span.addEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                    span.addEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                }
            }
        };

        CBufferVisualizer.#RecurseLayout(this.layouts[0], add_event_listeners);
        
        window.performance.measure("AddEventListeners", { start: start });
    }
    #DoVisualization() {
        let start = window.performance.now();
        this.#GetColors();
        this.#DoColoredText();
        this.#DoColoredRects();
        this.#AddEventListeners();

        window.performance.measure("DoVisualization", { start:start });
    }
    VisualizeCBuffer(input) {
        let start = window.performance.now();
        let lexer = new Lexer(input);
        let parser = new Parser(lexer);

        let cbuffers = parser.ParseFile();
        let parse_timer = window.performance.measure("Parse", { start: start });
        if (cbuffers.length == 0)
            throw new HLSLError("Need at least one Constant Buffer to visualize!", lexer.line, 1, 2000);

        this.layouts = new CBufferLayoutAlgorithm(cbuffers).GenerateLayout();
        window.performance.measure("Layout Algorithm", { start: parse_timer.startTime + parse_timer.duration });

        this.#DoVisualization();
    }
    SetExpandedArrays(expanded_arrays) {
        this.options.expanded_arrays = expanded_arrays;
        this.#DoVisualization();
    }
    SetTextAlignment(text_alignment) {
        this.options.text_alignment = text_alignment;
        this.#RemoveEventListeners();
        this.#DoColoredText();
        this.#AddEventListeners();
    }
    SetColorShuffle(color_shuffle) {
        this.options.color_shuffle = color_shuffle;
        this.#ReEvaluateColors();
    }
    SetColorShuffleSubdivisions(color_shuffle_subdivisions) {
        this.options.color_shuffle_subdivisions = color_shuffle_subdivisions;
        this.#ReEvaluateColors();
    }
    SetColorLightness(color_lightness) {
        this.options.color_lightness = color_lightness;
        this.#ReEvaluateColors();
    }
    SetColorSaturation(color_saturation) {
        this.options.color_saturation = color_saturation;
        this.#ReEvaluateColors();
    }
    SetDarkTheme(enable, color_lightness, color_saturation) {
        this.options.dark_theme = enable;
        this.options.color_lightness = color_lightness;
        this.options.color_saturation = color_saturation;
        this.#ApplyTheme();
    }
}