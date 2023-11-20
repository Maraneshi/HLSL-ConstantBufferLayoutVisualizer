export { GetSupportedKeywords } from './cbuffer_parser.js';
import { CBufferVisualizer } from './cbuffer_visualizer.js';
export { CBufferVisualizerOptionsDefault } from './cbuffer_visualizer.js';
import { hlsl_lang_config, hlsl_lang_def } from "./hlsl_monaco.js";

const dark_theme_sheet = document.querySelector('[title="Dark Theme"]');
function ApplyLightTheme() {
    dark_theme_sheet.disabled = true;
    monaco.editor.setTheme('vs');
    color_lightness.value = 0.72;
    color_lightness_value.value = 0.72;
    color_saturation.value = 1.0;
    color_saturation_value.value = 1.0;
    window.GlobalVisualizerObject?.SetDarkTheme(false, color_lightness.valueAsNumber, color_saturation.valueAsNumber);
}

function ApplyDarkTheme() {
    dark_theme_sheet.disabled = false;
    monaco.editor.setTheme('vs-dark');
    color_lightness.value = 0.60;
    color_lightness_value.value = 0.60;
    color_saturation.value = 0.60;
    color_saturation_value.value = 0.60;
    window.GlobalVisualizerObject?.SetDarkTheme(true, color_lightness.valueAsNumber, color_saturation.valueAsNumber);
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
        theme: 'vs-dark'
    });
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

export function EnableResizer(id) {
    // Query the element
    const resizer = document.getElementById(id);
    const leftSide = resizer.previousElementSibling;
    const rightSide = resizer.nextElementSibling;

    // The current position of mouse
    let x = 0;
    let y = 0;
    let leftWidth = 0;

    // Handle the mousedown event
    // that's triggered when user drags the resizer
    const mouseDownHandler = function (e) {
        // Get the current mouse position
        x = e.clientX;
        y = e.clientY;
        leftWidth = leftSide.getBoundingClientRect().width;

        // Attach the listeners to document
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };

    const mouseMoveHandler = function (e) {
        // How far the mouse has been moved
        const dx = e.clientX - x;
        const dy = e.clientY - y;

        const newLeftWidth = ((leftWidth + dx) * 100) / resizer.parentNode.getBoundingClientRect().width;
        leftSide.style.width = newLeftWidth + '%';

        resizer.style.cursor = 'col-resize';
        document.body.style.cursor = 'col-resize';

        leftSide.style.userSelect = 'none';
        leftSide.style.pointerEvents = 'none';

        rightSide.style.userSelect = 'none';
        rightSide.style.pointerEvents = 'none';
    };

    const mouseUpHandler = function () {
        resizer.style.removeProperty('cursor');
        document.body.style.removeProperty('cursor');

        leftSide.style.removeProperty('user-select');
        leftSide.style.removeProperty('pointer-events');

        rightSide.style.removeProperty('user-select');
        rightSide.style.removeProperty('pointer-events');

        // Remove the handlers of mousemove and mouseup
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    // Attach the handler
    resizer.addEventListener('mousedown', mouseDownHandler);
}
