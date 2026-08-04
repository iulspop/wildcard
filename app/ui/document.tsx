import type { Handle, RemixNode } from "remix/ui";
import { css } from "remix/ui";

export interface DocumentProps {
  children?: RemixNode;
  head?: RemixNode;
  title?: string;
}

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    const { children, head, title = "Wildcard" } = handle.props;

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="stylesheet" href="/app.css" />
          <meta name="theme-color" content="#15131b" />
          <title>{title}</title>
          {head}
        </head>
        <body mix={css({ margin: 0 })}>
          {children}
          <script type="module" src="/app.js" />
        </body>
      </html>
    );
  };
}
