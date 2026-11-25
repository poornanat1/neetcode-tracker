export function dateKey(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index ? String(part).padStart(2, '0') : part).join('-');
}

export function daysAfter(key, days) {
  const date = new Date(key + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function problemState(problem, attempts) {
  const latest = attempts.at(-1);
  const solved = problem.status === 'Done' || attempts.some(attempt => attempt.outcome === 'Done');
  const status = latest ? (latest.outcome === 'Done' ? 'Done' : 'Redo') : problem.status;
  const due = latest ? daysAfter(latest.date, status === 'Done' ? 7 : 2) : status === 'Redo' ? problem.date : '';
  return { solved, status: status || 'New', due };
}

export function practiceQueue(problems, state, today) {
  const dateFor = problem => state.dates[problem.id] || problem.date;
  const open = problems.filter(problem => problemState(problem, state.attempts[problem.id] || []).status === 'New');
  const todayItems = open.filter(problem => dateFor(problem) === today);
  const backlog = open.filter(problem => dateFor(problem) < today);
  if (new Date(today + 'T12:00:00').getDay() === 0) return todayItems;
  return [...todayItems, ...backlog.slice(0, Math.max(0, 3 - todayItems.length))];
}
