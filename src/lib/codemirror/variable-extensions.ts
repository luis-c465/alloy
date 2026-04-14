import { Decoration, DecorationSet, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate, hoverTooltip, tooltips } from "@codemirror/view";
import { type CompletionContext, type CompletionResult, autocompletion } from "@codemirror/autocomplete";
import { Facet, type Extension } from "@codemirror/state";

export type EnvironmentVariables = Record<string, string>;

export const environmentVariablesFacet = Facet.define<EnvironmentVariables, EnvironmentVariables>({
  combine: (values) => (values.length ? values[values.length - 1] : {}),
});

const variablePattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

const variableDecorator = new MatchDecorator({
  regexp: variablePattern,
  decoration: (match, view) => {
    const variables = view.state.facet(environmentVariablesFacet);
    const name = match[1];
    const hasVariable = Object.prototype.hasOwnProperty.call(variables, name);

    return Decoration.mark({
      class: hasVariable ? "cm-variable-defined" : "cm-variable-undefined",
    });
  },
});

export const variableHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = variableDecorator.createDeco(view);
    }

    update(update: ViewUpdate) {
      const previousVariables = update.startState.facet(environmentVariablesFacet);
      const currentVariables = update.state.facet(environmentVariablesFacet);

      if (
        update.docChanged ||
        update.viewportChanged ||
        previousVariables !== currentVariables
      ) {
        this.decorations = variableDecorator.updateDeco(update, this.decorations);
      }
    }
  },
  {
    decorations: (instance) => instance.decorations,
  }
);

function truncateValue(value: string): string {
  return value.length > 40 ? `${value.substring(0, 40)}...` : value;
}

export function variableCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\{\{[a-zA-Z0-9_]*$/);

  if (!match && !context.explicit) {
    return null;
  }

  const variables = context.state.facet(environmentVariablesFacet);
  const names = Object.keys(variables);

  if (names.length === 0) {
    return null;
  }

  return {
    from: match ? match.from : context.pos,
    options: names.map((name) => ({
      label: name,
      type: "variable",
      detail: truncateValue(variables[name]),
      apply: `{{${name}}}`,
    })),
    validFor: /^\{\{[a-zA-Z0-9_]*$/,
  };
}

function escapeHtml(value: string): string {
  const container = document.createElement("div");
  container.appendChild(document.createTextNode(value));
  return container.innerHTML;
}

function isInsideVariable(lineText: string, cursor: number): { from: number; to: number; name: string } | null {
  variablePattern.lastIndex = 0;

  let match: RegExpExecArray | null;

  while (true) {
    match = variablePattern.exec(lineText);
    if (match === null) {
      break;
    }

    const from = match.index;
    const to = from + match[0].length;
    if (cursor >= from && cursor <= to) {
      return {
        from,
        to,
        name: match[1],
      };
    }
  }

  return null;
}

export const variableHoverTooltip = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const relativePos = pos - line.from;
  const lineText = line.text;

  const match = isInsideVariable(lineText, relativePos);
  if (!match) {
    return null;
  }

  const variables = view.state.facet(environmentVariablesFacet);
  const value = variables[match.name];

  const isDefined = Object.prototype.hasOwnProperty.call(variables, match.name);

  const tooltip = document.createElement("div");
  tooltip.className = "cm-variable-tooltip";

  const label = document.createElement("div");
  label.className = "cm-tooltip-label";
  const labelName = document.createElement("strong");
  labelName.textContent = match.name;
  label.appendChild(labelName);

  tooltip.appendChild(label);

  if (isDefined) {
    const valueElement = document.createElement("div");
    valueElement.className = "cm-tooltip-value";
    valueElement.innerHTML = escapeHtml(value);
    tooltip.appendChild(valueElement);
  } else {
    const undefinedElement = document.createElement("div");
    undefinedElement.className = "cm-tooltip-undefined";
    undefinedElement.textContent = "Variable not defined";
    tooltip.appendChild(undefinedElement);
  }

  return {
    pos: line.from + match.from,
    end: line.from + match.to,
    above: false,
    create: () => ({
      dom: tooltip,
    }),
  };
});

export const variableBaseTheme = EditorView.baseTheme({
  ".cm-variable-defined": {
    background: "rgba(255, 165, 0, 0.15)",
    color: "#ff8c00",
    "border-radius": "3px",
    padding: "0 2px",
    "font-weight": "500",
  },
  ".cm-variable-undefined": {
    background: "rgba(255, 0, 0, 0.1)",
    color: "#dc2626",
    "border-radius": "3px",
    padding: "0 2px",
    "text-decoration": "wavy underline #dc2626",
  },
  ".cm-variable-tooltip": {
    padding: "6px 10px",
    "font-size": "12px",
    "max-width": "300px",
  },
  ".cm-variable-tooltip .cm-tooltip-label": {
    "font-weight": "600",
    "font-family": "monospace",
    color: "#ff8c00",
    "margin-bottom": "2px",
  },
  ".cm-variable-tooltip .cm-tooltip-value": {
    "font-family": "monospace",
    "word-break": "break-all",
    color: "#374151",
  },
  ".cm-variable-tooltip .cm-tooltip-undefined": {
    color: "#dc2626",
    "font-style": "italic",
  },
  "&dark .cm-variable-defined": {
    color: "#ffb84d",
    background: "rgba(255, 165, 0, 0.2)",
  },
  "&dark .cm-variable-undefined": {
    color: "#ef4444",
  },
  "&dark .cm-variable-tooltip .cm-tooltip-value": {
    color: "#d1d5db",
  },
});

export function variableExtension(variables: EnvironmentVariables): Extension {
  return [
    environmentVariablesFacet.of(variables),
    variableHighlightPlugin,
    autocompletion({
      override: [variableCompletionSource],
      activateOnTyping: true,
    }),
    tooltips({ parent: document.body }),
    variableHoverTooltip,
    variableBaseTheme,
  ];
}
