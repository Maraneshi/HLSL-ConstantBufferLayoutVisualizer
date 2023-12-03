export { GetSupportedKeywords } from './cbuffer_parser.js';
import { CBufferVisualizer } from './cbuffer_visualizer.js';
export { CBufferVisualizerOptionsDefault } from './cbuffer_visualizer.js';
import { hlsl_lang_config, hlsl_lang_def } from "./hlsl_monaco.js";

const dark_theme_sheet = document.querySelector('[title="CBV Dark Theme"]');
function ApplyLightTheme() {
    dark_theme_sheet.disabled = true;
    monaco.editor.setTheme('vs');
    CBV_color_lightness.value = 0.72;
    CBV_color_lightness_value.value = 0.72;
    CBV_color_saturation.value = 1.0;
    CBV_color_saturation_value.value = 1.0;
    window.CBV_VisualizerObject?.SetDarkTheme(false, CBV_color_lightness.valueAsNumber, CBV_color_saturation.valueAsNumber);
}

function ApplyDarkTheme() {
    dark_theme_sheet.disabled = false;
    monaco.editor.setTheme('vs-dark');
    CBV_color_lightness.value = 0.60;
    CBV_color_lightness_value.value = 0.60;
    CBV_color_saturation.value = 0.60;
    CBV_color_saturation_value.value = 0.60;
    window.CBV_VisualizerObject?.SetDarkTheme(true, CBV_color_lightness.valueAsNumber, CBV_color_saturation.valueAsNumber);
}

export function SetDarkTheme(enable) {
    if (enable)
        ApplyDarkTheme();
    else
        ApplyLightTheme();
}

export function CreateMonacoEditor(parent) {
    monaco.languages.register({ id: "hlsl" });
    monaco.languages.setMonarchTokensProvider('hlsl', hlsl_lang_def);
    monaco.languages.setLanguageConfiguration('hlsl', hlsl_lang_config);

    const editor = monaco.editor.create(parent, {
        value: `struct Test {
    float a, b;
};

cbuffer example {
    Test test[2];
    float Val1;
    float2 Val2[3][2];
    float Val3;
    struct { float c; } s;
    double d;
    float3x4 mat;
    float f;
    matrix<int,1,2> mat2;
    vector<double,1> dv;
    uint16_t u;
};`,
        language: 'hlsl',
        minimap: { enabled: false },
        automaticLayout: true,
        theme: 'vs-dark',
        scrollBeyondLastLine: false
    });
    parent.style.height = editor.getContentHeight() + 'px';
    return editor;
}

export function ParseHLSLAndVisualize(input_or_monaco, out_text, out_svg, options) {
    let start = window.performance.now();
    out_text.replaceChildren();
    if (!(input_or_monaco instanceof String))
        monaco.editor.setModelMarkers(CBV_monaco_editor.getModel(), "owner", []);

    try {
        let input = (input_or_monaco instanceof String) ? input_or_monaco : input_or_monaco.getValue();
        let viz = new CBufferVisualizer(out_text, out_svg, options);
        viz.VisualizeCBuffer(input);
        window.performance.measure("ParseHLSLAndVisualize", { start:start });
        return viz;
    }
    catch (error)
    {
        if (!(input_or_monaco instanceof String)) {
            var markers = [{
                severity: monaco.MarkerSeverity.error,
                message: error.message,
                startLineNumber: error.line,
                startColumn: error.start_column,
                endLineNumber: error.line,
                endColumn: error.end_column
            }];
            monaco.editor.setModelMarkers(CBV_monaco_editor.getModel(), "owner", markers);
        }

        out_svg.replaceChildren();
        out_text.replaceChildren();
        out_text.append(`ERROR(${error.line}:${error.start_column}): ${error.message}`);
        return null;
    }
}

export function EnableResizer(resizer, vertical) {
    // Query the element
    const prev = resizer.previousElementSibling;
    const next = resizer.nextElementSibling;

    // The current position of mouse
    let x = 0;
    let y = 0;
    let leftWidth = 0;
    let topHeight = 0;

    // Handle the mousedown event
    // that's triggered when user drags the resizer
    const mouseDownHandler = function (e) {
        e.preventDefault();
        // Get the current mouse position
        x = e.clientX;
        y = e.clientY;
        leftWidth = prev.getBoundingClientRect().width;
        topHeight = prev.getBoundingClientRect().height;

        // Attach the listeners to document
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };

    const mouseMoveHandler = function (e) {
        e.preventDefault();
        // How far the mouse has been moved
        const dx = (e.clientX - x) * 2; // HACK: since the element now grows to the left *and* right due to the flex centering, we need to double this
        const dy = e.clientY - y;

        if (vertical) {
            const newTopHeight = (topHeight + dy);
            prev.style.height = newTopHeight + 'px';
            resizer.style.cursor = 'row-resize';
            document.body.style.cursor = 'row-resize';
        }
        else {
            const newLeftWidth = (leftWidth + dx);
            prev.style.width = newLeftWidth + 'px';
            resizer.style.cursor = 'col-resize';
            document.body.style.cursor = 'col-resize';
        }

        prev.style.userSelect = 'none';
        prev.style.pointerEvents = 'none';

        next.style.userSelect = 'none';
        next.style.pointerEvents = 'none';
    };

    const mouseUpHandler = function (e) {
        e.preventDefault();
        resizer.style.removeProperty('cursor');
        document.body.style.removeProperty('cursor');

        prev.style.removeProperty('user-select');
        prev.style.removeProperty('pointer-events');

        next.style.removeProperty('user-select');
        next.style.removeProperty('pointer-events');

        // Remove the handlers of mousemove and mouseup
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    // Attach the handler
    resizer.addEventListener('mousedown', mouseDownHandler);
}
