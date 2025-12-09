import {
  testExports,
} from "../../functions/ingredicheck/memoji.ts";

const {
  buildPromptFromOptions,
  normalizeConfig,
  validateRequest,
  generatePromptHash,
  buildGenerationParams,
} = testExports;

Deno.test("memoji validates compact options when prompt is absent", () => {
  const body = {
    familyType: "father",
    gesture: "wave",
    hair: "short",
    skinTone: "medium",
    background: "auto",
    size: "1024x1024",
    model: "gpt-image-1",
  };
  const result = validateRequest(body);
  if (!result.ok) throw new Error(result.message);
});

Deno.test("memoji builds prompt from compact options", () => {
  const prompt = buildPromptFromOptions({
    familyType: "mother",
    gesture: "thumbs_up",
    hair: "long curly",
    skinTone: "light",
    accessories: ["glasses"],
    colorTheme: "warm-pink",
    background: "auto",
  });
  if (!prompt.includes("mother")) throw new Error("Prompt missing family type");
  if (!prompt.includes("thumbs-up")) throw new Error("Prompt missing gesture");
  if (!prompt.includes("glasses")) throw new Error("Prompt missing accessories");
  if (!prompt.includes("soft pastel sweater")) throw new Error("Prompt missing clothing theme");
  const expected = "A premium 3D Memoji-style avatar of a mother with long curly and light skin tone. Include head, shoulders, and hands with a thumbs-up gesture. soft pastel sweater. wearing glasses. Pastel circular background. Soft rounded shapes, glossy textures, minimal modern style. Cheerful happy face with warm eyes.";
  if (prompt !== expected) throw new Error("Prompt does not match expected template");
});

Deno.test("memoji rejects invalid params", () => {
  const badSize = validateRequest({ prompt: "x", size: "999x999" });
  if (badSize.ok) throw new Error("Expected size validation failure");
  const badBg = validateRequest({ prompt: "x", background: "weird" });
  if (badBg.ok) throw new Error("Expected background validation failure");
  const badModel = validateRequest({ prompt: "x", model: "other" });
  if (badModel.ok) throw new Error("Expected model validation failure");
});

Deno.test("memoji config normalization produces stable hash", async () => {
  const configA = normalizeConfig({
    model: "gpt-image-1",
    size: "1024x1024",
    familyType: "father",
    gesture: "wave",
    hair: "Short",
    skinTone: "Medium",
    accessories: ["glasses", "hat"],
    colorTheme: "pastel-blue",
    background: "auto",
  });
  const configB = normalizeConfig({
    model: "gpt-image-1",
    size: "1024x1024",
    familyType: "father",
    gesture: "wave",
    hair: "short",
    skinTone: "medium",
    accessories: ["hat", "glasses"], // different order, should normalize
    colorTheme: "pastel-blue",
    background: "auto",
  });
  const hashA = await generatePromptHash(configA);
  const hashB = await generatePromptHash(configB);
  if (hashA !== hashB) throw new Error("Hashes should be stable for equivalent configs");
});

Deno.test("memoji generation params request exactly one image", () => {
  const config = normalizeConfig({
    model: "gpt-image-1",
    size: "1024x1024",
    background: "auto",
  });
  const params = buildGenerationParams("gpt-image-1", "Prompt text", config);
  if (params.n !== 1) throw new Error("Expected n=1");
  if (params.prompt !== "Prompt text") throw new Error("Prompt not forwarded");
  if (params.size !== "1024x1024") throw new Error("Size not forwarded");
  if (params.background !== "auto") throw new Error("Background not forwarded");
});

