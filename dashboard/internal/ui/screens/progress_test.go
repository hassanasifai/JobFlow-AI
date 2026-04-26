package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestProgressViewFitsCompactViewport(t *testing.T) {
	pm := NewProgressModel(
		theme.NewTheme("catppuccin-mocha"),
		model.ProgressMetrics{
			FunnelStages: []model.FunnelStage{
				{Label: "Evaluated", Count: 120, Pct: 100},
				{Label: "Applied", Count: 80, Pct: 66.7},
				{Label: "Responded", Count: 30, Pct: 37.5},
				{Label: "Interview", Count: 12, Pct: 15},
				{Label: "Offer", Count: 2, Pct: 2.5},
			},
			ScoreBuckets: []model.ScoreBucket{
				{Label: "4.5-5.0", Count: 10},
				{Label: "4.0-4.4", Count: 40},
				{Label: "3.5-3.9", Count: 50},
			},
			WeeklyActivity: []model.WeekActivity{
				{Week: "2026-W14", Count: 18},
				{Week: "2026-W15", Count: 22},
			},
			ResponseRate:  37.5,
			InterviewRate: 15,
			OfferRate:     2.5,
			AvgScore:      4.2,
			TotalOffers:   2,
			ActiveApps:    92,
		},
		70,
		24,
	)

	parts := map[string]string{
		"header": pm.renderHeader(),
		"funnel": pm.renderFunnel(),
		"scores": pm.renderScoreDistribution(),
		"rates":  pm.renderRates(),
		"weekly": pm.renderWeeklyActivity(),
		"help":   pm.renderHelp(),
	}
	for name, part := range parts {
		for _, line := range strings.Split(part, "\n") {
			if got := lipgloss.Width(line); got > 70 {
				t.Fatalf("expected %s line to fit width 70, got width %d: %q", name, got, line)
			}
		}
	}

	for _, line := range strings.Split(pm.View(), "\n") {
		if got := lipgloss.Width(line); got > 70 {
			t.Fatalf("expected progress view line to fit width 70, got width %d: %q", got, line)
		}
	}
}
