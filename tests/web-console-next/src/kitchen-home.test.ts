import { friendlyName, greetingFor } from "@web-console-next/components/kitchen/home";

describe("Home greeting (CP-5)", () => {
  it("changes with the time of day", () => {
    expect(greetingFor(6)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(16)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good evening");
    expect(greetingFor(2)).toBe("Good evening");
  });

  it("greets by first name, else the email's local part, else nothing", () => {
    expect(friendlyName("Rahul Varghese", "r@example.com")).toBe("Rahul");
    expect(friendlyName("  ", "anu@example.com")).toBe("anu");
    expect(friendlyName(null, "dev@example.com")).toBe("dev");
    expect(friendlyName(null, null)).toBeNull();
  });
});
