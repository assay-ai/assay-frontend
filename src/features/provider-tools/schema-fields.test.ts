import { describe, expect, it } from "vitest";

import { fieldProblems, fieldsFromSchema, optionalFromSchema, schemaExtras, schemaFromFields, starterCheck, starterExample } from "./schema-fields";

const text = (schema: unknown) => JSON.stringify(schema, null, 2);

describe("the field editor round-trips a schema exactly", () => {
  it("keeps a list's item type and additionalProperties", () => {
    const schema = {
      type: "object",
      properties: { ids: { type: "array", items: { type: "integer" }, description: "Row ids." }, q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    };
    const rows = fieldsFromSchema(text(schema))!;
    expect(rows.find((r) => r.name === "ids")).toMatchObject({ type: "array", itemType: "integer", required: false });
    expect(JSON.parse(schemaFromFields(rows, schemaExtras(text(schema))))).toEqual(schema);
  });

  it("sends a schema the rows can't write back exactly to the JSON editor", () => {
    expect(fieldsFromSchema(text({ type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } }))).toBeNull();
    expect(fieldsFromSchema(text({ type: "object", properties: { a: { type: "string", enum: ["x"] } } }))).toBeNull();
    expect(fieldsFromSchema(text({ type: "object", properties: { a: { type: "array", items: { type: "string", format: "uri" } } } }))).toBeNull();
    expect(fieldsFromSchema(text({ type: "object", properties: { a: { type: "string", description: "" } } }))).toBeNull();
    expect(fieldsFromSchema("{")).toBeNull();
  });

  it("treats a missing required list as an empty one", () => {
    expect(fieldsFromSchema(text({ type: "object", properties: { a: { type: "string" } } }))).toEqual([{ name: "a", type: "string", required: false, description: "" }]);
  });
});

describe("field rows", () => {
  it("names what is wrong, allowing a leading underscore", () => {
    expect(fieldProblems([{ name: "_id", type: "string", required: true, description: "" }])).toEqual([]);
    expect(fieldProblems([{ name: "1x", type: "string", required: true, description: "" }])[0]).toMatch(/starting with a letter or “_”/);
    expect(fieldProblems([{ name: "", type: "string", required: true, description: "" }])).toEqual(["Field 1 needs a name."]);
  });

  it("marks an imported schema's unrequired fields optional", () => {
    expect(optionalFromSchema({ type: "object", properties: { a: {}, b: {} }, required: ["a"] })).toEqual(["b"]);
  });

  it("starts an example and a check from the fields", () => {
    const input = [{ name: "q", type: "string" as const, required: true, description: "" }];
    const output = [{ name: "posts", type: "array" as const, required: true, description: "" }];
    expect(starterExample(input, output)).toEqual({ title: "A typical call", arguments: { q: "example q" }, result: { posts: ["example posts"] } });
    expect(starterCheck(output)).toMatchObject({ type: "MIN_ARRAY_LENGTH", path: "$.posts", min: 1 });
  });
});
