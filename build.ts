import { z } from "zod";
import { SpacePackage } from "./src/space";

// io: "input" so fields with defaults stay optional for authors.
const schema = z.toJSONSchema(SpacePackage, { io: "input" });
await Bun.write(new URL("./space.schema.json", import.meta.url), JSON.stringify(schema, null, 2) + "\n");
console.log("wrote space.schema.json");
