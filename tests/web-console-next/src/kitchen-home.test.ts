import type { MyBalancesResponse, MyGroupBalance } from "@saas/contracts/kitchen";
import { friendlyName, homeGreeting, homeMoney, moneyLine } from "@web-console-next/components/kitchen/home";

describe("Home greeting (CP-5; SM-10: the canvas's \"Hi, Rahul\")", () => {
  it("says hi by name, or just hi", () => {
    expect(homeGreeting("Rahul")).toBe("Hi, Rahul");
    expect(homeGreeting(null)).toBe("Hi");
  });

  it("greets by first name, else the email's local part, else nothing", () => {
    expect(friendlyName("Rahul Varghese", "r@example.com")).toBe("Rahul");
    expect(friendlyName("  ", "anu@example.com")).toBe("anu");
    expect(friendlyName(null, "dev@example.com")).toBe("dev");
    expect(friendlyName(null, null)).toBeNull();
  });
});

describe("Home's one money line (SM-10)", () => {
  const group = (slug: string, currency: string, balanceMinor: number): MyGroupBalance => ({
    orgId: `org_${slug}`,
    slug,
    name: slug,
    currency,
    balanceMinor,
    role: "builder",
    memberCount: 3,
  });
  const balances = (groups: MyGroupBalance[], totals: MyBalancesResponse["totals"]): Pick<MyBalancesResponse, "groups" | "totals"> => ({ groups, totals });

  it("says each direction in plain words, never 'owed' or 'net'", () => {
    expect(moneyLine({ currency: "INR", netMinor: 6250 })).toEqual({ currency: "INR", tone: "owed", label: "You get back", amount: "₹62.50", text: "You get back ₹62.50" });
    expect(moneyLine({ currency: "USD", netMinor: -2500 })).toEqual({ currency: "USD", tone: "owe", label: "You owe", amount: "$25.00", text: "You owe $25.00" });
    expect(moneyLine({ currency: "INR", netMinor: 0 })).toEqual({ currency: "INR", tone: "settled", label: "Settled up", amount: null, text: "Settled up" });
  });

  it("leads with the person's currency (most of their groups) and adds any other currency under it, never across", () => {
    const money = homeMoney(
      balances([group("flat", "INR", 8650), group("lunch", "INR", -2400), group("trip", "USD", -2500)], [
        { currency: "INR", owedToYouMinor: 9000, youOweMinor: 2750, netMinor: 6250 },
        { currency: "USD", owedToYouMinor: 0, youOweMinor: 2500, netMinor: -2500 },
      ]),
    );
    expect(money.main.text).toBe("You get back ₹62.50");
    expect(money.others.map((o) => o.text)).toEqual(["You owe $25.00"]);
    expect(money.noGroups).toBe(false);
  });

  it("works the other way round: you owe in your currency, get back in another", () => {
    const money = homeMoney(
      balances([group("flat", "INR", -4575), group("flat2", "INR", 0), group("trip", "USD", 1200)], [
        { currency: "USD", owedToYouMinor: 1200, youOweMinor: 0, netMinor: 1200 },
        { currency: "INR", owedToYouMinor: 0, youOweMinor: 4575, netMinor: -4575 },
      ]),
    );
    expect(money.main).toMatchObject({ tone: "owe", text: "You owe ₹45.75" });
    expect(money.others.map((o) => o.text)).toEqual(["You get back $12.00"]);
  });

  it("puts a currency with money open first when the person's own is settled, and drops settled ones", () => {
    const money = homeMoney(
      balances([group("a", "INR", 0), group("b", "INR", 0), group("trip", "USD", -2500)], [
        { currency: "INR", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 },
        { currency: "USD", owedToYouMinor: 0, youOweMinor: 2500, netMinor: -2500 },
      ]),
    );
    expect(money.main.text).toBe("You owe $25.00");
    expect(money.others).toEqual([]);
  });

  it("is settled up when nothing is open, and says when there are no groups yet", () => {
    expect(homeMoney(balances([group("a", "INR", 0)], [{ currency: "INR", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 }]))).toMatchObject({
      main: { text: "Settled up" },
      others: [],
      noGroups: false,
    });
    expect(homeMoney(balances([], []))).toMatchObject({ main: { text: "Settled up" }, others: [], noGroups: true });
  });

  it("lists no people: who owes whom is People's, and each payment is a to-do", () => {
    const money = homeMoney(balances([group("flat", "INR", 100)], [{ currency: "INR", owedToYouMinor: 100, youOweMinor: 0, netMinor: 100 }]));
    expect(Object.keys(money).sort()).toEqual(["main", "noGroups", "others"]);
  });
});
