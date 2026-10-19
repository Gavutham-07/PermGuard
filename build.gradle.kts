tasks.register<Exec>("assembleDebug") {
    commandLine("npm", "run", "build")
}

tasks.register<Exec>("testDebugUnitTest") {
    commandLine("npm", "run", "test")
}

tasks.register("build") {
    dependsOn("assembleDebug")
}
