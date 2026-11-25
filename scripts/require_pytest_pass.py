"""Fail CI suites that report skipped cases, including during collection."""

import pytest


class RequiredTests:
    def __init__(self):
        self.has_skips = False

    def pytest_collectreport(self, report):
        if report.skipped:
            self.has_skips = True

    def pytest_runtest_logreport(self, report):
        if report.skipped:
            self.has_skips = True

    def pytest_sessionfinish(self, session, exitstatus):
        if self.has_skips and exitstatus == pytest.ExitCode.OK:
            session.exitstatus = pytest.ExitCode.TESTS_FAILED

    def pytest_terminal_summary(self, terminalreporter):
        if self.has_skips:
            terminalreporter.write_line(
                "Required verification failed because tests were skipped."
            )


def pytest_configure(config):
    config.pluginmanager.register(RequiredTests())
