package main

import "github.com/gin-gonic/gin"

// Certification locks are retired. These compatibility entry points keep the
// existing CRUD and archived migration handlers under ordinary edit permissions.
func isContentMechanicsLocked(_ *JSONMap) bool { return false }

func isContentMechanicsLockedValue(_ any) bool { return false }

func rejectLockedContentMutation(_ *gin.Context, _ *JSONMap) bool { return false }

func rejectLockedMechanicsMutation(_ *gin.Context, _, _, _ *JSONMap) bool { return false }
