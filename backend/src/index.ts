import { Elysia, t } from "elysia";

const app = new Elysia()
  .get("/", () => "Hello Elysia")
  .post(
    "/log",
    ({ body }) => {
      console.log("[Python Log]:", body.message);
      return { status: "received" };
    },
    {
      body: t.Object({
        message: t.String(),
      }),
    }
  )
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
