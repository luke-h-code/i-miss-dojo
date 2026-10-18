// Short context for the writer, and light cleanup shared by generation and rendering.
export function featuredPicks(markdown) {
  return [...tidyMarkdown(markdown).matchAll(/^###\s+\d+\.\s+(.+)([\s\S]*?)(?=^#{1,3}\s|^---|$(?![\s\S]))/gm)]
    .map(([, name, body]) => {
      const details = body.match(/^\*\*([^\n]+?)\*\*([^\n]*)/m);
      return `${name}${details ? ` — ${details[1]}${details[2]}` : ""}`
        .replace(/\*|\[([^\]]+)\]\([^)]*\)/g, "$1").slice(0, 240);
    });
}

export function tidyMarkdown(markdown) {
  return markdown
    .replace(/\s*\(\[[^\]]*\]\(https?:\/\/[^\s]*?\)\)/g, "")
    .replace(/\]\((https?:\/\/[^\s)]+)\)/g, (link, href) => {
      const url = new URL(href);
      if (url.searchParams.get("utm_source") !== "openai") return link;
      url.searchParams.delete("utm_source");
      return `](${url.href})`;
    })
    .replace(/^([^\n#*_][^\n]*)\n+(?=# )/, "*$1*\n\n");
}
