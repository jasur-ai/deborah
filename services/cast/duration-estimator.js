/**
 * Edikit — Cast Duration Estimator
 * ---------------------------------
 * Config + test metadata → taxminiy davomiylik (range).
 * UI'da exact emas, range ko'rsatiladi.
 */

/**
 * Estimate session duration.
 *
 * @param {object} input
 * @param {object} input.config — resolved config (timer, playback, leaderboard, teams)
 * @param {number} input.questionCount
 * @returns {{minimumSeconds:number, expectedSeconds:number, maximumSeconds:number, label:string}}
 */
export function estimateDuration({ config, questionCount = 0 }) {
  const timerSec = config?.timer?.defaultSeconds || 30;
  const thinkSec = config?.playback?.thinkSeconds || 0;
  const timerMode = config?.timer?.mode || 'soft';
  const lbFreq = config?.leaderboard?.frequency || 'end_only';
  const teamMode = !!(config?.teams && config.teams.enabled);

  let perQuestionMin, perQuestionExp, perQuestionMax;
  if (timerMode === 'off') {
    // host-controlled — range keng
    perQuestionMin = 20;
    perQuestionExp = 45;
    perQuestionMax = 120;
  } else {
    perQuestionMin = thinkSec + timerSec;
    perQuestionExp = thinkSec + timerSec + 12; // reveal/discussion
    perQuestionMax = thinkSec + timerSec + 40;
  }
  if (teamMode) {
    perQuestionMin += 20;
    perQuestionExp += 30;
    perQuestionMax += 45;
  }

  let lbBlocks = 0;
  if (lbFreq === 'every_question') lbBlocks = questionCount;
  else if (lbFreq === 'every_n') lbBlocks = Math.ceil(questionCount / 5);
  else if (lbFreq === 'milestones') lbBlocks = Math.max(1, Math.ceil(questionCount / 10));
  // end_only / never / manual → 1 final block
  else if (questionCount > 0) lbBlocks = 1;

  const lbSec = lbBlocks * 25;

  const min = Math.round(questionCount * perQuestionMin + lbSec);
  const exp = Math.round(questionCount * perQuestionExp + lbSec);
  const max = Math.round(questionCount * perQuestionMax + lbSec);

  const label = `Taxminan ${formatMin(max / 60)}–${formatMin(max / 60)} daqiqa`;
  const fmt = (s) => {
    const m = Math.max(1, Math.round(s / 60));
    return `${m}`;
  };
  return {
    minimumSeconds: min,
    expectedSeconds: exp,
    maximumSeconds: max,
    label: `Taxminan ${fmt(min)}–${fmt(max)} daqiqa`,
  };
}

function formatMin(secs) {
  return String(Math.max(1, Math.round(secs)));
}
