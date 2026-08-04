import { createController } from "remix/router";

import { routes } from "../routes.ts";
import { HomePage } from "../ui/scaffold-home-page.tsx";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<HomePage />);
    },
    room(context) {
      return context.render(<HomePage />);
    },
  },
});
