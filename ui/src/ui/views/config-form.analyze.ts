import { pathKey, schemaType, type JsonSchema } from "./config-form.shared.ts";

export type ConfigSchemaAnalysis = {
  schema: JsonSchema | null;
  unsupportedPaths: string[];
};

const META_KEYS = new Set(["title", "description", "default", "nullable"]);

function isAnySchema(schema: JsonSchema): boolean {
  const keys = Object.keys(schema ?? {}).filter((key) => !META_KEYS.has(key));
  return keys.length === 0;
}

function normalizeEnum(values: unknown[]): { enumValues: unknown[]; nullable: boolean } {
  const filtered = values.filter((value) => value != null);
  const nullable = filtered.length !== values.length;
  const enumValues: unknown[] = [];
  for (const value of filtered) {
    if (!enumValues.some((existing) => Object.is(existing, value))) {
      enumValues.push(value);
    }
  }
  return { enumValues, nullable };
}

function isObjectLikeSchema(schema: JsonSchema): boolean {
  const type = schemaType(schema);
  return type === "object" || Boolean(schema.properties || schema.additionalProperties);
}

function cloneSchemaNode(schema: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(schema)) as JsonSchema;
}

function mergeIntersectionObjectSchemas(entries: JsonSchema[], outer: JsonSchema): JsonSchema | null {
  if (entries.length === 0 || !entries.every((entry) => isObjectLikeSchema(entry))) {
    return null;
  }

  const mergedRequired = new Set<string>();
  let hasExplicitAdditionalProperties = false;
  let mergedAdditionalProperties: JsonSchema | boolean | undefined = undefined;
  const mergedProperties: Record<string, JsonSchema> = {};

  for (const entry of entries) {
    for (const key of entry.required ?? []) {
      mergedRequired.add(key);
    }
    for (const [key, value] of Object.entries(entry.properties ?? {})) {
      mergedProperties[key] = cloneSchemaNode(value);
    }
    if (entry.additionalProperties !== undefined) {
      hasExplicitAdditionalProperties = true;
      mergedAdditionalProperties = entry.additionalProperties;
    }
  }

  return {
    ...outer,
    type: "object",
    properties: mergedProperties,
    required: Array.from(mergedRequired),
    ...(hasExplicitAdditionalProperties
      ? { additionalProperties: mergedAdditionalProperties }
      : {}),
    anyOf: undefined,
    oneOf: undefined,
    allOf: undefined,
  };
}

function mergeUnionObjectSchemas(entries: JsonSchema[], outer: JsonSchema): JsonSchema | null {
  if (entries.length === 0 || !entries.every((entry) => isObjectLikeSchema(entry))) {
    return null;
  }

  const mergedProperties: Record<string, JsonSchema> = {};
  let requiredIntersection: Set<string> | null = null;
  let allAdditionalPropertiesFalse = true;

  for (const entry of entries) {
    const required = new Set(entry.required ?? []);
    requiredIntersection =
      requiredIntersection == null
        ? required
        : new Set([...requiredIntersection].filter((key) => required.has(key)));

    for (const [key, value] of Object.entries(entry.properties ?? {})) {
      if (!(key in mergedProperties)) {
        mergedProperties[key] = cloneSchemaNode(value);
      }
    }

    if (entry.additionalProperties !== false) {
      allAdditionalPropertiesFalse = false;
    }
  }

  return {
    ...outer,
    type: "object",
    properties: mergedProperties,
    ...(requiredIntersection && requiredIntersection.size > 0
      ? { required: Array.from(requiredIntersection) }
      : { required: [] }),
    ...(allAdditionalPropertiesFalse ? { additionalProperties: false } : {}),
    anyOf: undefined,
    oneOf: undefined,
    allOf: undefined,
  };
}

export function analyzeConfigSchema(raw: unknown): ConfigSchemaAnalysis {
  if (!raw || typeof raw !== "object") {
    return { schema: null, unsupportedPaths: ["<root>"] };
  }
  return normalizeSchemaNode(raw as JsonSchema, []);
}

function normalizeSchemaNode(
  schema: JsonSchema,
  path: Array<string | number>,
): ConfigSchemaAnalysis {
  const unsupported = new Set<string>();
  const normalized: JsonSchema = { ...schema };
  const pathLabel = pathKey(path) || "<root>";

  if (schema.anyOf || schema.oneOf) {
    const union = normalizeUnion(schema, path);
    if (union) {
      return union;
    }
    return { schema, unsupportedPaths: [pathLabel] };
  }
  if (schema.allOf) {
    const intersection = normalizeIntersection(schema, path);
    if (intersection) {
      return intersection;
    }
    return { schema, unsupportedPaths: [pathLabel] };
  }

  const nullable = Array.isArray(schema.type) && schema.type.includes("null");
  const type =
    schemaType(schema) ?? (schema.properties || schema.additionalProperties ? "object" : undefined);
  normalized.type = type ?? schema.type;
  normalized.nullable = nullable || schema.nullable;

  if (normalized.enum) {
    const { enumValues, nullable: enumNullable } = normalizeEnum(normalized.enum);
    normalized.enum = enumValues;
    if (enumNullable) {
      normalized.nullable = true;
    }
    if (enumValues.length === 0) {
      unsupported.add(pathLabel);
    }
  }

  if (type === "object") {
    const properties = schema.properties ?? {};
    const normalizedProps: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(properties)) {
      const res = normalizeSchemaNode(value, [...path, key]);
      if (res.schema) {
        normalizedProps[key] = res.schema;
      }
      for (const entry of res.unsupportedPaths) {
        unsupported.add(entry);
      }
    }
    normalized.properties = normalizedProps;

    if (schema.additionalProperties === true) {
      // Treat `true` as an untyped map schema so dynamic object keys can still be edited.
      normalized.additionalProperties = {};
    } else if (schema.additionalProperties === false) {
      normalized.additionalProperties = false;
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      if (!isAnySchema(schema.additionalProperties)) {
        const res = normalizeSchemaNode(schema.additionalProperties, [...path, "*"]);
        normalized.additionalProperties = res.schema ?? schema.additionalProperties;
        if (res.unsupportedPaths.length > 0) {
          unsupported.add(pathLabel);
        }
      }
    }
  } else if (type === "array") {
    const itemsSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (!itemsSchema) {
      unsupported.add(pathLabel);
    } else {
      const res = normalizeSchemaNode(itemsSchema, [...path, "*"]);
      normalized.items = res.schema ?? itemsSchema;
      if (res.unsupportedPaths.length > 0) {
        unsupported.add(pathLabel);
      }
    }
  } else if (
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean" &&
    !normalized.enum
  ) {
    unsupported.add(pathLabel);
  }

  return {
    schema: normalized,
    unsupportedPaths: Array.from(unsupported),
  };
}

function normalizeIntersection(
  schema: JsonSchema,
  path: Array<string | number>,
): ConfigSchemaAnalysis | null {
  const allOf = schema.allOf;
  if (!allOf || allOf.length === 0) {
    return null;
  }

  const merged = mergeIntersectionObjectSchemas(allOf, schema);
  if (!merged) {
    return null;
  }

  return normalizeSchemaNode(merged, path);
}

function isSecretRefVariant(entry: JsonSchema): boolean {
  if (schemaType(entry) !== "object") {
    return false;
  }
  const source = entry.properties?.source;
  const provider = entry.properties?.provider;
  const id = entry.properties?.id;
  if (!source || !provider || !id) {
    return false;
  }
  return (
    typeof source.const === "string" &&
    schemaType(provider) === "string" &&
    schemaType(id) === "string"
  );
}

function isSecretRefUnion(entry: JsonSchema): boolean {
  const variants = entry.oneOf ?? entry.anyOf;
  if (!variants || variants.length === 0) {
    return false;
  }
  return variants.every((variant) => isSecretRefVariant(variant));
}

function normalizeSecretInputUnion(
  schema: JsonSchema,
  path: Array<string | number>,
  remaining: JsonSchema[],
  nullable: boolean,
): ConfigSchemaAnalysis | null {
  const stringIndex = remaining.findIndex((entry) => schemaType(entry) === "string");
  if (stringIndex < 0) {
    return null;
  }
  const nonString = remaining.filter((_, index) => index !== stringIndex);
  if (nonString.length !== 1 || !isSecretRefUnion(nonString[0])) {
    return null;
  }
  return normalizeSchemaNode(
    {
      ...schema,
      ...remaining[stringIndex],
      nullable,
      anyOf: undefined,
      oneOf: undefined,
      allOf: undefined,
    },
    path,
  );
}

function normalizeUnion(
  schema: JsonSchema,
  path: Array<string | number>,
): ConfigSchemaAnalysis | null {
  const union = schema.anyOf ?? schema.oneOf;
  if (!union) {
    return null;
  }

  const literals: unknown[] = [];
  const remaining: JsonSchema[] = [];
  let nullable = false;
  const aggregatedUnsupported = new Set<string>();

  for (const rawEntry of union) {
    const entry =
      rawEntry.allOf != null
        ? normalizeIntersection(rawEntry, path)
        : { schema: rawEntry, unsupportedPaths: [] };
    if (!entry?.schema) {
      return null;
    }
    for (const unsupportedPath of entry.unsupportedPaths) {
      aggregatedUnsupported.add(unsupportedPath);
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }
    if (Array.isArray(entry.schema.enum)) {
      const { enumValues, nullable: enumNullable } = normalizeEnum(entry.schema.enum);
      literals.push(...enumValues);
      if (enumNullable) {
        nullable = true;
      }
      continue;
    }
    if ("const" in entry.schema) {
      if (entry.schema.const == null) {
        nullable = true;
        continue;
      }
      literals.push(entry.schema.const);
      continue;
    }
    if (schemaType(entry.schema) === "null") {
      nullable = true;
      continue;
    }
    remaining.push(entry.schema);
  }

  // Config secrets accept either a raw key string or a structured secret ref object.
  // The form only supports editing the string path for now.
  const secretInput = normalizeSecretInputUnion(schema, path, remaining, nullable);
  if (secretInput) {
    return secretInput;
  }

  if (literals.length > 0 && remaining.length === 0) {
    const unique: unknown[] = [];
    for (const value of literals) {
      if (!unique.some((existing) => Object.is(existing, value))) {
        unique.push(value);
      }
    }
    return {
      schema: {
        ...schema,
        enum: unique,
        nullable,
        anyOf: undefined,
        oneOf: undefined,
        allOf: undefined,
      },
      unsupportedPaths: Array.from(aggregatedUnsupported),
    };
  }

  if (remaining.length === 1) {
    const res = normalizeSchemaNode(remaining[0], path);
    if (res.schema) {
      res.schema.nullable = nullable || res.schema.nullable;
    }
    for (const unsupportedPath of aggregatedUnsupported) {
      res.unsupportedPaths.push(unsupportedPath);
    }
    return res;
  }

  const mergedObjectUnion = mergeUnionObjectSchemas(remaining, schema);
  if (mergedObjectUnion) {
    const res = normalizeSchemaNode(
      {
        ...mergedObjectUnion,
        nullable,
      },
      path,
    );
    for (const unsupportedPath of aggregatedUnsupported) {
      res.unsupportedPaths.push(unsupportedPath);
    }
    return {
      schema: res.schema,
      unsupportedPaths: Array.from(new Set(res.unsupportedPaths)),
    };
  }

  const renderableUnionTypes = new Set([
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
  ]);
  if (
    remaining.length > 0 &&
    literals.length === 0 &&
    remaining.every((entry) => {
      const type = schemaType(entry);
      return Boolean(type) && renderableUnionTypes.has(String(type));
    })
  ) {
    return {
      schema: {
        ...schema,
        nullable,
      },
      unsupportedPaths: Array.from(aggregatedUnsupported),
    };
  }

  return null;
}
