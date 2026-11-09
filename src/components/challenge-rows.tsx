// Where a challenge stands, in one line ("Day 5 of 29, 1 of 2 shields left", "Starts Saturday, September
// 26", "Finished, with 1 bought shield"), under its name on a friend's page, the pledge screen and the
// challenge's own page. (Its list of rows went with Past challenges' cards, T137.)

import { finishedText, shieldsLabel, type ChallengeSummary } from '@/lib/challenges';
import { fromDateString } from '@/lib/profile';

/** Where a challenge stands, in one line. */
export function statusLine(c: ChallengeSummary): string {
  switch (c.state) {
    case 'upcoming':
      return `Starts ${fromDateString(c.startDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
    case 'active':
      return `Day ${c.today} of ${c.daysRequired}, ${shieldsLabel(c.shieldsLeft, c.shieldsTotal).toLowerCase()}`;
    case 'finished':
      return finishedText(c.boughtShields);
    case 'not_finished':
      return 'Not finished';
    case 'cancelled':
      return 'Cancelled';
  }
}

