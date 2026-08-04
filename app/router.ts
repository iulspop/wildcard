import { createRouter, type MiddlewareContext } from "remix/router";

import controller from "./actions/controller.tsx";
import { render } from "./middleware/render.tsx";
import { routes } from "./routes.ts";
import {
  envContext,
  executionContext,
  getWorkerBindings,
} from "./services/env.server.ts";

const workerBindings = async (
  context: Parameters<ReturnType<typeof render>>[0],
  next: () => Promise<Response>,
) => {
  const bindings = getWorkerBindings(context.request);
  context.set(envContext, bindings.env);
  context.set(executionContext, bindings.executionContext);
  return next();
};

type AppContext = MiddlewareContext<
  [typeof workerBindings, ReturnType<typeof render>]
>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

export const router = createRouter<AppContext>({
  middleware: [workerBindings, render()],
});

router.map(routes, controller);
