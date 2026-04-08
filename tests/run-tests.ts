import { runSeenPostRepositoryTests } from "./SeenPostRepository.test";
import { runTelegramFormatterTests } from "./TelegramFormatter.test";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const tests: TestCase[] = [
  {
    name: "SeenPostRepository",
    run: runSeenPostRepositoryTests
  },
  {
    name: "TelegramFormatter",
    run: runTelegramFormatterTests
  }
];

async function main(): Promise<void> {
  let failures = 0;

  for (const testCase of tests) {
    try {
      await testCase.run();
      // eslint-disable-next-line no-console
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures += 1;
      // eslint-disable-next-line no-console
      console.error(`FAIL ${testCase.name}`);
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log("All tests passed.");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
