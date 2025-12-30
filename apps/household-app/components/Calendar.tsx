import type { DayExpenses } from '../hooks/use-calendar-expenses';

interface CalendarProps {
  year: number;
  month: number;
  expensesByDay: Map<string, DayExpenses>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick?: (date: string, expenses: DayExpenses | undefined) => void;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * 指定月のカレンダー日付を生成
 */
function generateCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const days: (number | null)[] = [];

  // 月初の空白
  for (let i = 0; i < startDayOfWeek; i++) {
    days.push(null);
  }

  // 月の日付
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }

  return days;
}

/**
 * 日付文字列を生成 (YYYY-MM-DD)
 */
function formatDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * カレンダーコンポーネント
 * 日付ごとの支出を表示
 */
export function Calendar({
  year,
  month,
  expensesByDay,
  onPrevMonth,
  onNextMonth,
  onDayClick,
}: CalendarProps) {
  const days = generateCalendarDays(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDate = today.getDate();

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button className="calendar-nav-btn" onClick={onPrevMonth} aria-label="前月">
          ←
        </button>
        <h2 className="calendar-title">
          {year}年{month}月
        </h2>
        <button className="calendar-nav-btn" onClick={onNextMonth} aria-label="次月">
          →
        </button>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((day, index) => (
          <div
            key={day}
            className={`calendar-weekday ${index === 0 ? 'sunday' : ''} ${index === 6 ? 'saturday' : ''}`}
          >
            {day}
          </div>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="calendar-day empty" />;
          }

          const dateStr = formatDateString(year, month, day);
          const dayExpenses = expensesByDay.get(dateStr);
          const isToday = isCurrentMonth && day === todayDate;
          const dayOfWeek = (index % 7);
          const isSunday = dayOfWeek === 0;
          const isSaturday = dayOfWeek === 6;

          return (
            <div
              key={dateStr}
              className={`calendar-day ${isToday ? 'today' : ''} ${dayExpenses ? 'has-expense' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''}`}
              onClick={() => onDayClick?.(dateStr, dayExpenses)}
            >
              <span className="calendar-day-number">{day}</span>
              {dayExpenses && (
                <span className="calendar-day-amount">
                  {formatCurrency(dayExpenses.total)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
