import { describe, it, expect } from "vitest";
import {
  buildFriendFromIntra,
  pickMainCursus,
} from "../src/features/friends/friends-intra";

describe("pickMainCursus", () => {
  it("prefers the main cursus, then the highest level", () => {
    const list = [
      { slug: "c-piscine", grade: "Pisciner", level: 4.2 },
      { slug: "42cursus", grade: "Learner", level: 1.5 },
    ];
    expect(pickMainCursus(list)?.slug).toBe("42cursus");
    expect(pickMainCursus([list[0], { slug: "other", level: 6 }])?.level).toBe(6);
    expect(pickMainCursus([])).toBeNull();
    expect(pickMainCursus("garbage")).toBeNull();
  });
});

describe("buildFriendFromIntra", () => {
  it("maps intrapy payloads to the widget shape", () => {
    const f = buildFriendFromIntra(
      "alepayen",
      {
        first_name: "Alexis",
        last_name: "Payen",
        wallet: 12,
        evaluation_points: 7,
        location: "k0r4p1",
        pool_month: "september",
        pool_year: 2026,
      },
      { profile_picture: "https://cdn.intra.42.fr/users/x/alepayen.jpg" },
      [{ slug: "c-piscine", grade: "Pisciner", level: 3.75 }],
      null,
    );
    expect(f).toMatchObject({
      login: "alepayen",
      displayName: "Alexis Payen",
      avatar: "https://cdn.intra.42.fr/users/x/alepayen.jpg",
      level: 3.75,
      grade: "Pisciner",
      isOnline: true,
      lastSeen: "k0r4p1",
      poolLabel: "09/2026",
      wallet: 12,
      correctionPoints: 7,
      customAvatar: null,
    });
  });

  it("degrades gracefully when payloads are missing", () => {
    const f = buildFriendFromIntra("bob", null, null, null, 123);
    expect(f).toMatchObject({
      login: "bob",
      displayName: "bob",
      avatar: null,
      level: 0,
      grade: null,
      isOnline: false,
      lastSeen: null,
      poolLabel: null,
      wallet: 0,
      correctionPoints: 0,
      lastOnlineTimestamp: 123,
    });
  });

  it("ignores non-URL pictures and falls back to correction_point", () => {
    const f = buildFriendFromIntra(
      "eve",
      { displayname: "Eve", correction_point: 3 },
      { profile_picture: "eve.jpg" },
      [],
      null,
    );
    expect(f.avatar).toBeNull();
    expect(f.displayName).toBe("Eve");
    expect(f.correctionPoints).toBe(3);
  });
});
