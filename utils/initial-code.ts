export function getInitialCodeTemplate(componentType: string): string {
  const name = componentType.charAt(0).toUpperCase() + componentType.slice(1);

  if (componentType === "Text") {
    return `export default function Text() {
  return (
    <div className="text-foreground min-w-[1ch] break-words whitespace-pre-wrap">
      Double click to edit text
    </div>
  );
}
`;
  }

  if (componentType === "Container") {
    return `export default function Container() {
  return (
    <div className="w-full h-full bg-card text-card-foreground flex flex-col rounded-xl ring-1 ring-foreground/10 overflow-hidden">
    </div>
  );
}
`;
  }

  if (componentType === "Card") {
    return `export default function Card() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-card text-card-foreground">
    </div>
  );
}
`;
  }

  return `export default function ${name}() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-card text-card-foreground rounded-xl border border-border p-6">
      <p className="text-muted-foreground text-sm">${name}</p>
    </div>
  );
}
`;
}
