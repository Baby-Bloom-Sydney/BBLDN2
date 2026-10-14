import { describe, it, expect } from "vitest";
import { isChatTile, readPersistedTile, type ChatTile } from "./tiles";

describe("isChatTile", () => {
  it("accepts a valid katie_note tile", () => {
    const tile: ChatTile = {
      kind: "katie_note",
      data: { body: "Reminder: Obie's dentist appointment is tomorrow." },
    };
    expect(isChatTile(tile)).toBe(true);
  });

  it("accepts katie_note with optional fields", () => {
    const tile: ChatTile = {
      kind: "katie_note",
      data: {
        badge: "Reminder",
        title: "Dentist tomorrow",
        body: "Oliver has a dentist appointment at 10am.",
        action: { label: "Add to calendar", href: "/calendar" },
      },
    };
    expect(isChatTile(tile)).toBe(true);
  });

  it("rejects null / undefined / primitives", () => {
    expect(isChatTile(null)).toBe(false);
    expect(isChatTile(undefined)).toBe(false);
    expect(isChatTile("foo")).toBe(false);
    expect(isChatTile(42)).toBe(false);
  });

  it("rejects tile with missing kind", () => {
    expect(isChatTile({ data: { body: "x" } })).toBe(false);
  });

  it("rejects tile with unknown kind", () => {
    expect(
      isChatTile({ kind: "not_a_real_kind_xyz", data: { id: "whatever" } }),
    ).toBe(false);
  });

  it("accepts bsr_job and job_match id-only tiles", () => {
    expect(isChatTile({ kind: "bsr_job", data: { id: "bsr-1" } })).toBe(true);
    expect(isChatTile({ kind: "job_match", data: { id: "m-1" } })).toBe(true);
    expect(isChatTile({ kind: "bsr_job", data: { id: "" } })).toBe(false);
    expect(isChatTile({ kind: "job_match", data: {} })).toBe(false);
  });

  it("accepts parent_position and parent_placement id-only tiles", () => {
    expect(isChatTile({ kind: "parent_position", data: { id: "pos-1" } })).toBe(
      true,
    );
    expect(isChatTile({ kind: "parent_placement", data: { id: "pl-1" } })).toBe(
      true,
    );
    expect(isChatTile({ kind: "parent_position", data: { id: "" } })).toBe(
      false,
    );
    expect(isChatTile({ kind: "parent_placement", data: {} })).toBe(false);
  });

  // ── Draft (sudo) tile validation — WU 8.22b ────────────────────────
  it("accepts a draft wrapping a valid katie_note preview", () => {
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d-1",
          toolName: "create_tile",
          args: { body: "..." },
          preview: {
            kind: "katie_note",
            data: { body: "Reminder: dentist tomorrow" },
          },
        },
      }),
    ).toBe(true);
  });

  it("accepts a draft wrapping a valid diary preview (feed-item shape)", () => {
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d-2",
          toolName: "log_food",
          args: { food: "banana" },
          preview: {
            kind: "diary",
            data: {
              item: {
                id: "log-1",
                child_client_id: "c1",
                author_id: "u-1",
                author_name: "Katie",
                type: "diary",
                status: "ready",
                context: "adhoc",
                parent_log_id: null,
                data: { kind: "food", title: "Breakfast" },
                created_at: "2026-04-30T00:00:00Z",
                updated_at: "2026-04-30T00:00:00Z",
              },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects a draft missing draftId / toolName / args", () => {
    expect(
      isChatTile({
        kind: "draft",
        data: {
          toolName: "x",
          args: {},
          preview: { kind: "katie_note", data: { body: "y" } },
        },
      }),
    ).toBe(false);
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d",
          args: {},
          preview: { kind: "katie_note", data: { body: "y" } },
        },
      }),
    ).toBe(false);
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d",
          toolName: "x",
          preview: { kind: "katie_note", data: { body: "y" } },
        },
      }),
    ).toBe(false);
  });

  it("rejects a draft whose preview kind is not draftable", () => {
    // connection_request is a read tile — never appropriate as a
    // draft preview.
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d",
          toolName: "x",
          args: {},
          preview: { kind: "connection_request", data: { id: "c-1" } },
        },
      }),
    ).toBe(false);
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d",
          toolName: "x",
          args: {},
          preview: {
            kind: "verification_status",
            data: { headline: "x", steps: [] },
          },
        },
      }),
    ).toBe(false);
  });

  it("rejects a draft whose preview itself fails validation", () => {
    expect(
      isChatTile({
        kind: "draft",
        data: {
          draftId: "d",
          toolName: "x",
          args: {},
          preview: { kind: "katie_note", data: { body: "" } }, // empty body fails katie_note check
        },
      }),
    ).toBe(false);
  });

  it("accepts a valid activity tile", () => {
    expect(
      isChatTile({
        kind: "activity",
        data: {
          item: {
            id: "log-1",
            child_client_id: "c1",
            author_id: "u-1",
            author_name: "Katie",
            type: "activity",
            status: "ready",
            context: "adhoc",
            parent_log_id: null,
            data: { title: "Peek-a-Voice Buddy", activity_json: {} },
            created_at: "2026-04-24T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects activity tile with missing item", () => {
    expect(isChatTile({ kind: "activity", data: {} })).toBe(false);
  });

  it("rejects activity tile whose inner type isn't 'activity'", () => {
    expect(
      isChatTile({
        kind: "activity",
        data: {
          item: {
            id: "x",
            child_client_id: "c1",
            author_id: "u",
            author_name: "Katie",
            type: "observation",
            status: "ready",
            context: "adhoc",
            parent_log_id: null,
            data: {},
            created_at: "",
            updated_at: "",
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts a valid progress tile", () => {
    expect(
      isChatTile({
        kind: "progress",
        data: {
          item: {
            id: "p1",
            child_client_id: "c1",
            author_id: "u-1",
            author_name: "Katie",
            type: "progress",
            status: "completed",
            context: "adhoc",
            parent_log_id: null,
            data: {
              updates: [{ id: "CL_12_18_1", score: 4 }],
              title: "Progress Update",
              image_url: null,
              note: null,
            },
            created_at: "2026-04-24T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects progress tile whose inner type isn't 'progress'", () => {
    expect(
      isChatTile({
        kind: "progress",
        data: {
          item: {
            id: "x",
            child_client_id: "c1",
            author_id: "u",
            author_name: "Katie",
            type: "observation",
            status: "completed",
            context: "adhoc",
            parent_log_id: null,
            data: {},
            created_at: "",
            updated_at: "",
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts a valid verification_status tile with steps", () => {
    expect(
      isChatTile({
        kind: "verification_status",
        data: {
          headline: "You're verified.",
          steps: [
            { label: "Profile complete", status: "verified" },
            { label: "ID verified", status: "verified" },
            { label: "Enhanced DBS check", status: "verified" },
          ],
        },
      }),
    ).toBe(true);
  });

  it("accepts a verification_status tile with action link", () => {
    expect(
      isChatTile({
        kind: "verification_status",
        data: {
          headline: "Start verification.",
          steps: [{ label: "Profile complete", status: "verified" }],
          action: { label: "Start", href: "/nanny/verification" },
        },
      }),
    ).toBe(true);
  });

  it("rejects verification_status tile with missing headline", () => {
    expect(
      isChatTile({
        kind: "verification_status",
        data: { steps: [] },
      }),
    ).toBe(false);
  });

  it("rejects verification_status tile with malformed steps", () => {
    expect(
      isChatTile({
        kind: "verification_status",
        data: {
          headline: "x",
          steps: [{ label: "only label, no status" }],
        },
      }),
    ).toBe(false);
  });

  it("accepts a valid connection_request tile (id-only)", () => {
    expect(
      isChatTile({
        kind: "connection_request",
        data: { id: "conn-abc" },
      }),
    ).toBe(true);
  });

  it("rejects connection_request tile with empty id", () => {
    expect(isChatTile({ kind: "connection_request", data: { id: "" } })).toBe(
      false,
    );
  });

  it("rejects connection_request tile with missing id", () => {
    expect(isChatTile({ kind: "connection_request", data: {} })).toBe(false);
  });

  it("rejects katie_note with empty body", () => {
    expect(isChatTile({ kind: "katie_note", data: { body: "" } })).toBe(false);
  });

  it("rejects katie_note missing body", () => {
    expect(isChatTile({ kind: "katie_note", data: { title: "t" } })).toBe(
      false,
    );
  });
});

describe("readPersistedTile", () => {
  it("returns null for null", () => {
    expect(readPersistedTile(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(readPersistedTile(undefined)).toBeNull();
  });

  it("returns null for malformed shapes without throwing", () => {
    expect(readPersistedTile({ kind: "not_a_real_kind" })).toBeNull();
    expect(readPersistedTile("string")).toBeNull();
    expect(readPersistedTile([])).toBeNull();
  });

  it("returns the tile for a valid katie_note", () => {
    const tile = { kind: "katie_note", data: { body: "hello" } };
    expect(readPersistedTile(tile)).toEqual(tile);
  });
});
