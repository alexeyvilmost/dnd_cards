package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// main currently wires concrete controllers directly, so this source-level
// route contract protects the authorization boundary without constructing the
// full application (which would require PostgreSQL and external services).
func TestGlobalContentCRUDMutationsUseContentAdminAllowlist(t *testing.T) {
	sourceBytes, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	if !strings.Contains(source, "contentAdminAuth := ContentAdminAuthMiddleware(authService)") {
		t.Fatal("content-admin authorization middleware is not configured")
	}

	collections := []string{
		"cards", "actions", "effects", "spells", "feats", "backgrounds",
		"races", "classes", "resources", "variables", "concepts",
	}
	for _, collection := range collections {
		for _, route := range []struct {
			method string
			path   string
		}{
			{method: "POST", path: "/" + collection},
			{method: "PUT", path: "/" + collection + "/:id"},
			{method: "DELETE", path: "/" + collection + "/:id"},
		} {
			pattern := regexp.MustCompile(
				`api\.` + route.method + `\("` + regexp.QuoteMeta(route.path) + `",\s*contentAdminAuth,`,
			)
			if !pattern.MatchString(source) {
				t.Errorf("%s %s must use contentAdminAuth", route.method, route.path)
			}
		}
	}

	if !regexp.MustCompile(`api\.POST\("/cards/generate-image",\s*contentAdminAuth,`).MatchString(source) {
		t.Error("card image mutation must use contentAdminAuth")
	}
	for _, pattern := range []string{
		`api\.POST\("/images/generate-standalone",\s*contentAdminAuth,`,
		`api\.POST\("/ai/mechanics",\s*contentAdminAuth,`,
	} {
		if !regexp.MustCompile(pattern).MatchString(source) {
			t.Errorf("paid AI route must use contentAdminAuth: %s", pattern)
		}
	}
	for _, routePattern := range []string{
		`protected\.POST\("/images/upload",\s*contentAdminAuth,`,
		`protected\.POST\("/images/generate",\s*contentAdminAuth,`,
		`protected\.DELETE\("/images/:entity_type/:entity_id",\s*contentAdminAuth,`,
		`protected\.POST\("/images/setup-cors",\s*contentAdminAuth,`,
		`protected\.GET\("/images/status",\s*contentAdminAuth,`,
		`protected\.POST\("/image-library",\s*contentAdminAuth,`,
		`protected\.PUT\("/image-library/:id",\s*contentAdminAuth,`,
		`protected\.DELETE\("/image-library/:id",\s*contentAdminAuth,`,
		`protected\.POST\("/image-library/update-from-cards",\s*contentAdminAuth,`,
		`protected\.POST\("/image-library/sync-missing",\s*contentAdminAuth,`,
	} {
		if !regexp.MustCompile(routePattern).MatchString(source) {
			t.Errorf("global image-library mutation is not content-admin-only: %s", routePattern)
		}
	}
	for _, routePattern := range []string{
		`api\.PUT\("/content-support/:entityType/:id",\s*contentAdminAuth,`,
		`api\.POST\("/content-support/batch-exact",\s*contentAdminAuth,`,
		`api\.POST\("/content-migrations/:bundleId/effects",\s*contentAdminAuth,`,
		`api\.POST\("/content-migrations/:bundleId/:entityType/:id/exact-update",\s*contentAdminAuth,`,
		`api\.POST\("/content-rollback/effect/:id/hard-delete-created",\s*contentAdminAuth,`,
		`api\.POST\("/content-rollback/:entityType/:id/support",\s*contentAdminAuth,`,
	} {
		if !regexp.MustCompile(routePattern).MatchString(source) {
			t.Errorf("certification/migration mutation is not content-admin-only: %s", routePattern)
		}
	}
	if !regexp.MustCompile(
		`protected\.POST\("/shops",\s*shopCreateRateLimit\.Handler\(\),`,
	).MatchString(source) {
		t.Error("public shop creation must remain rate-limited")
	}
	shopSourceBytes, err := os.ReadFile("shop_controller.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(
		string(shopSourceBytes),
		"DELETE FROM shops WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'",
	) {
		t.Error("public shop storage must delete expired rows")
	}
}

func TestGlobalContentReadsRemainPublicAndCharacterV3UsesStrictAuth(t *testing.T) {
	sourceBytes, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, collection := range []string{
		"cards", "actions", "effects", "spells", "feats", "backgrounds",
		"races", "classes", "resources", "variables", "concepts",
	} {
		pattern := regexp.MustCompile(
			`api\.GET\("/` + collection + `",\s*OptionalAuthMiddleware\(authService\),`,
		)
		if !pattern.MatchString(source) {
			t.Errorf("GET /%s must remain public with optional auth", collection)
		}
	}

	for _, unchanged := range []string{
		"protected.Use(AuthMiddleware(authService))",
		`protected.POST("/characters", characterController.CreateCharacter)`,
		`protected.POST("/characters-v2", characterV2Controller.CreateCharacterV2)`,
	} {
		if !strings.Contains(source, unchanged) {
			t.Errorf("character/session auth contract changed or disappeared: %s", unchanged)
		}
	}
	if !strings.Contains(source, "registerCharacterV3Routes(api, authService, characterV3Controller)") {
		t.Fatal("CharacterV3 route set is not registered through its strict boundary")
	}
	if regexp.MustCompile(`protected\.(?:GET|POST|PUT|PATCH|DELETE)\("/characters-v3`).MatchString(source) {
		t.Fatal("CharacterV3 route leaked back into the prototype AuthMiddleware group")
	}
	routeBytes, err := os.ReadFile("character_v3_routes.go")
	if err != nil {
		t.Fatal(err)
	}
	routeSource := string(routeBytes)
	if !strings.Contains(routeSource, "routes.Use(StrictAuthMiddleware(authService))") {
		t.Fatal("CharacterV3 routes must require StrictAuthMiddleware")
	}
	for _, route := range []string{
		`routes.POST("", controller.CreateCharacterV3)`,
		`routes.GET("", controller.GetCharactersV3)`,
		`routes.GET("/:id", controller.GetCharacterV3)`,
		`routes.PUT("/:id", controller.UpdateCharacterV3)`,
		`routes.DELETE("/:id", controller.DeleteCharacterV3)`,
		`routes.GET("/:id/events", controller.GetCharacterEvents)`,
		`routes.PATCH("/:id/runtime", controller.PatchCharacterRuntime)`,
	} {
		if !strings.Contains(routeSource, route) {
			t.Errorf("CharacterV3 strict route missing: %s", route)
		}
	}
	eventRoute := regexp.MustCompile(
		`routes\.POST\(\s*"/:id/events",\s*JSONBodyLimitMiddleware\(maxCharacterEventBatchBodyBytes\),\s*RequestBodyLimitMiddleware\(maxCharacterEventBatchBodyBytes\),\s*controller\.PostCharacterEvents,\s*\)`,
	)
	if !eventRoute.MatchString(routeSource) {
		t.Error("CharacterV3 event route must retain strict body limits")
	}
}
