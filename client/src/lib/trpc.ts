import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/** Server return types, so components describe data by its procedure rather than restating it. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
