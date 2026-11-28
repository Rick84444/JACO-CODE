# Add this folder from the pinned SDK audio2face-sdk/source/samples/CMakeLists.txt.
add_executable(jaco-a2f main.cpp)
target_compile_features(jaco-a2f PRIVATE cxx_std_17)
target_link_libraries(jaco-a2f PRIVATE audio2x)
set_target_properties(jaco-a2f PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${A2F_BINARY_DIR}/bin")
