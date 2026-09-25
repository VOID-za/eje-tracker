/**
 * Project arithmetic.
 *
 * THE HEADLINE NUMBER IS DELIBERATELY UNFLATTERING. "Percent complete" counts
 * only DONE, and DONE requires the work to have been finished, tested and
 * accepted. Items that are merely IMPLEMENTED — the code exists — are counted
 * separately and shown separately, because conflating the two is exactly the
 * failure this tracker was built to stop.
 */
import { CLOSED_STATUSES, STUCK_STATUSES } from './model.mjs';

const total = (counts) => counts.reduce((sum, row) => sum + row.n, 0);
const of = (counts, ...statuses) =>
  counts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.n, 0);

export const summarise = (statusCounts, deliveryCounts = []) => {
  const all = total(statusCounts);
  const done = of(statusCounts, 'DONE');
  const built = of(statusCounts, 'IMPLEMENTED', 'TESTING', 'APPROVED');
  const working = of(statusCounts, 'IN_PROGRESS');
  const stuck = statusCounts
    .filter((row) => STUCK_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.n, 0);
  const closed = statusCounts
    .filter((row) => CLOSED_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.n, 0);
  const openWork = all - closed;
  const deployed = deliveryCounts
    .filter((row) => row.delivery === 'DEPLOYED')
    .reduce((sum, row) => sum + row.n, 0);
  const pushedNotDeployed = deliveryCounts
    .filter((row) => ['COMMITTED', 'PUSHED'].includes(row.delivery))
    .reduce((sum, row) => sum + row.n, 0);

  const percent = (value) => (all === 0 ? 0 : Math.round((value / all) * 1000) / 10);

  return {
    all,
    done,
    built,
    working,
    stuck,
    closed,
    openWork,
    deployed,
    pushedNotDeployed,
    donePercent: percent(done),
    builtPercent: percent(built),
    workingPercent: percent(working),
    stuckPercent: percent(stuck),
    deployedPercent: percent(deployed),
  };
};
