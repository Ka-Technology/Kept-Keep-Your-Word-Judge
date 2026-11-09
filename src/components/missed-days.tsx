// The missed days of a challenge, in words: each day it missed, and whether a shield it started with
// broke or a shield was bought for it (owner, 2026-10-01: friends and backers can see which missed
// days were bought back). On the challenge's detail screen, and on the pledge screen friends and
// backers open. Renders nothing before the first miss.

import { ListRow, ListSection } from '@/components/list';
import { missedDayText, type ChallengeSummary } from '@/lib/challenges';

export function MissedDays({ challenge }: { challenge: ChallengeSummary }) {
  if (challenge.missedDays.length === 0) return null;
  return (
    <ListSection title="Missed days" footer="A bought shield keeps a challenge going after a miss with no shield left. Half its price goes to the charity.">
      {challenge.missedDays.map((d, i) => (
        <ListRow key={d.day} label={missedDayText(d)} first={i === 0} />
      ))}
    </ListSection>
  );
}
