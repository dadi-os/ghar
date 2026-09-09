import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadConfig,
  loadDatabaseConfig,
  resetConfigCache,
} from "../src/config.js";

test("loadConfig requires DATABASE_URL", () => {
  resetConfigCache();
  const previousDb = process.env.DATABASE_URL;
  const previousMatter = process.env.MATTER_STORAGE_PATH;
  delete process.env.DATABASE_URL;
  process.env.MATTER_STORAGE_PATH = previousMatter ?? "/tmp/ghar-test-matter";
  try {
    assert.throws(() => loadConfig(), /DATABASE_URL is required/);
  } finally {
    if (previousDb !== undefined) {
      process.env.DATABASE_URL = previousDb;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (previousMatter !== undefined) {
      process.env.MATTER_STORAGE_PATH = previousMatter;
    } else {
      delete process.env.MATTER_STORAGE_PATH;
    }
    resetConfigCache();
  }
});

test("loadConfig requires MATTER_STORAGE_PATH", () => {
  resetConfigCache();
  const previousDb = process.env.DATABASE_URL;
  const previousMatter = process.env.MATTER_STORAGE_PATH;
  process.env.DATABASE_URL = previousDb ?? "postgres://ghar:ghar@localhost:5432/ghar";
  delete process.env.MATTER_STORAGE_PATH;
  try {
    assert.throws(() => loadConfig(), /MATTER_STORAGE_PATH is required/);
  } finally {
    if (previousDb !== undefined) {
      process.env.DATABASE_URL = previousDb;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (previousMatter !== undefined) {
      process.env.MATTER_STORAGE_PATH = previousMatter;
    } else {
      delete process.env.MATTER_STORAGE_PATH;
    }
    resetConfigCache();
  }
});

test("loadConfig returns required env when set", () => {
  resetConfigCache();
  assert.ok(process.env.DATABASE_URL);
  assert.ok(process.env.MATTER_STORAGE_PATH);
  const config = loadConfig();
  assert.equal(config.env.databaseUrl, process.env.DATABASE_URL);
  assert.equal(config.env.matterStoragePath, process.env.MATTER_STORAGE_PATH);
});

test("loadDatabaseConfig requires DATABASE_URL only", () => {
  const previousDb = process.env.DATABASE_URL;
  const previousMatter = process.env.MATTER_STORAGE_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.MATTER_STORAGE_PATH;
  try {
    assert.throws(() => loadDatabaseConfig(), /DATABASE_URL is required/);
  } finally {
    if (previousDb !== undefined) {
      process.env.DATABASE_URL = previousDb;
    }
    if (previousMatter !== undefined) {
      process.env.MATTER_STORAGE_PATH = previousMatter;
    }
  }
});
