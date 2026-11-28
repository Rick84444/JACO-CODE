// JACO bridge based on the public NVIDIA Audio2Face SDK interface.
// SDK revision 1ca0f02535ed774f5dbcd724a31cd486368dc783 (MIT).
#include "audio2face/audio2face.h"
#include "audio2x/cuda_utils.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <locale>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>
struct Destroyer { template<typename T> void operator()(T* x) const { if(x)x->Destroy(); } };
template<typename T> using Ptr=std::unique_ptr<T,Destroyer>;
void check(std::error_code e){if(e)throw std::runtime_error(e.message());}
struct Frame { double time; std::vector<float> weights; };
struct Output { std::mutex lock; std::vector<Frame> frames; bool failed=false; size_t rate=16000,count=0; };
void collect(void* user,const nva2f::IBlendshapeExecutor::HostResults& r,std::error_code e){
 auto& o=*static_cast<Output*>(user);std::lock_guard<std::mutex> guard(o.lock);
 if(e||r.trackIndex!=0||r.weights.Size()!=o.count||o.frames.size()>=2700){o.failed=true;return;}
 if(r.timeStampCurrentFrame<0)return;
 o.frames.push_back({double(r.timeStampCurrentFrame)/o.rate,{r.weights.Data(),r.weights.Data()+r.weights.Size()}});
}
int main(int argc,char** argv){
 try{
  if(argc!=4)return 2;
  std::ifstream in(argv[3],std::ios::binary|std::ios::ate);std::streamoff bytes=in.tellg();
  if(!in||bytes<320||bytes>1280000||bytes%4!=0)return 2;
  std::vector<float> pcm(static_cast<size_t>(bytes)/4);in.seekg(0);in.read(reinterpret_cast<char*>(pcm.data()),bytes);
  if(!in||!std::all_of(pcm.begin(),pcm.end(),[](float x){return std::isfinite(x)&&std::abs(x)<=1.01f;}))return 2;
  check(nva2x::SetCudaDeviceIfNeeded(0));
  using Opt=nva2f::IGeometryExecutor::ExecutionOption;
  const std::string kind=argv[2];
  Output out;
  Ptr<nva2f::IBlendshapeExecutorBundle> bundle(kind=="diffusion"?
   nva2f::ReadDiffusionBlendshapeSolveExecutorBundle(1,argv[1],Opt::Skin,false,0,true,nullptr,nullptr):
   nva2f::ReadRegressionBlendshapeSolveExecutorBundle(1,argv[1],Opt::Skin,false,60,1,nullptr,nullptr));
  if(!bundle)throw std::runtime_error("bundle unavailable");
  auto& exec=bundle->GetExecutor();out.rate=exec.GetSamplingRate();out.count=exec.GetWeightCount();
  if(exec.GetResultType()!=nva2f::IBlendshapeExecutor::ResultsType::HOST||out.rate!=16000||out.count<8||out.count>128)throw std::runtime_error("unsupported model output");
  nva2f::IBlendshapeSolver* solver=nullptr;check(nva2f::GetExecutorSkinSolver(exec,0,&solver));
  if(!solver||static_cast<size_t>(solver->NumBlendshapePoses())!=out.count)throw std::runtime_error("pose names unavailable");
  std::vector<std::string> names;
  for(size_t i=0;i<out.count;i++){const char* n=solver->GetPoseName(i);if(!n)throw std::runtime_error("missing name");std::string s(n);if(s.empty()||s.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")!=std::string::npos)throw std::runtime_error("invalid name");names.push_back(s);}
  check(exec.SetResultsCallback(collect,&out));
  auto& em=bundle->GetEmotionAccumulator(0);std::vector<float> neutral(em.GetEmotionSize(),0.0f);
  check(em.Accumulate(0,{neutral.data(),neutral.size()},bundle->GetCudaStream().Data()));check(em.Close());
  auto& audio=bundle->GetAudioAccumulator(0);check(audio.Accumulate({pcm.data(),pcm.size()},bundle->GetCudaStream().Data()));check(audio.Close());
  while(nva2x::GetNbReadyTracks(exec)>0)check(exec.Execute(nullptr));
  check(exec.Wait(0));if(out.failed||out.frames.empty())throw std::runtime_error("no frames");
  std::sort(out.frames.begin(),out.frames.end(),[](const Frame& a,const Frame& b){return a.time<b.time;});
  std::cout.imbue(std::locale::classic());std::cout<<"\nJACO_A2F_JSON:{\"protocol\":\"jaco-a2f/1\",\"names\":[";
  for(size_t i=0;i<names.size();i++){if(i)std::cout<<',';std::cout<<'"'<<names[i]<<'"';}
  std::cout<<"],\"frames\":[";
  for(size_t i=0;i<out.frames.size();i++){if(i)std::cout<<',';std::cout<<'['<<out.frames[i].time;for(float x:out.frames[i].weights){if(!std::isfinite(x))return 3;std::cout<<','<<x;}std::cout<<']';}
  std::cout<<"]}\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
